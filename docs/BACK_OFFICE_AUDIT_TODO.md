# Back-office follow-up to the contracts audit

The smart contracts audit is being addressed on the `audit` branch, in `contracts/` only.
Some fixes change the contracts' interface, and the back-office has to follow. This file
lists what the back-office team needs to change, one section per audit finding. New items
are added as more findings are fixed.

The ABI copies in `back-office/shared/` and `back-office/web/src/blockchain/` are already
regenerated (`node contracts/scripts/export-abi.js`). Don't edit them by hand.

---

## 1. TAO authority comes from its DID, and the registry is linked once

Covers two findings:

- **A rotated TAO key kept the owner's powers.** It could transfer ownership of both
  contracts and lock out the TAO's new key.
- **The registry's governance could be repointed.** A single TAO key could switch the
  registry to a contract of its own, revoke any certificate for good and write records in
  any TI's name.

### What changed in the contracts

- `CertificateGovernance` has **no owner**: `owner()`, `transferOwnership` and
  `renounceOwnership` are gone. `onlyTao` (`addTi`, `setCosigners`, `setTiAttribute`)
  accepts any key that the DID Registry currently lists as a capabilityInvocation key of
  `taoDid()`, and no other key.
- `CertificateGovernance.initialize(address tao, string taoDid, address registry)` is now
  **`initialize(string taoDid, address registry)`**.
- `CertificateGovernance.setCertificateRegistry` is **removed**. The registry is fixed at
  initialization.
- `CertificateRegistry.initialize(address tao)` is unchanged.
  `CertificateRegistry.setGovernance` works **once**, by the owner, and only for a
  governance contract whose `certificateRegistry()` is this registry. That call also
  **ends the registry's ownership**: afterwards `owner()` returns `address(0)`.
- `deployments/<network>.json` no longer has a `governance.owner` field.

### To do

- [ ] **Deploy a TAO's pair with the new initializer.**
      [`server/lifecycle/tao-contracts.ts:412`](../back-office/server/lifecycle/tao-contracts.ts#L412):
      `governanceInterface.encodeFunctionData('initialize', [owner, tao.did, registry.address])`
      → `[tao.did, registry.address]`. The governance address is derived from the init data
      (CREATE2), so it changes too. That's expected.
      The `setGovernance` call that follows can stay as it is. Its
      `governance() !== governance.address` guard still makes resuming safe.
      Also update the doc comment at line 280 ("TAO's own key owns both contracts…").
      The registry is owned only until it is linked, and governance has no owner.

- [ ] **Replace the owner check before `addTi`.**
      [`server/lifecycle/ti-governance.ts:145`](../back-office/server/lifecycle/ti-governance.ts#L145)
      calls `reader.owner()`, which no longer exists. Check instead that the TAO's ledger
      key is a key of the TAO's DID. Read `didRegistry()` from the governance contract and
      call `checkController(bytes taoDid, address key)` on it. Keep the same `pending`
      result when the check fails, with a reason like "The TAO's key is not listed in the
      TAO's DID yet."

- [ ] **Remove the ownership hand-over from the development bootstrap.**
      [`scripts/bootstrap-development.ts`](../back-office/scripts/bootstrap-development.ts):
      `handOver` (lines 9–46) and its call (lines 106–114) would now fail, because
      governance has no `owner()` and the registry's owner is `address(0)` once
      `Deploy.s.sol` has linked it. No hand-over is needed: the TAO's KMS ledger key is
      already listed in the TAO's DID by the seed, so it acts as the TAO. Remove the
      function, the `ownable` ABI, `developmentTao`, the RPC/chain-id checks that only
      served it, and the unused `ethers` imports. Reword the final message (line 141)
      "owns the governance contracts" → e.g. "administers the governance contract".

- [ ] **Update the seed comment.**
      [`scripts/seed-development.ts:218`](../back-office/scripts/seed-development.ts#L218)
      says the TAO's ledger key "must own" the contracts and that bootstrap transfers
      ownership. Neither is true anymore.

- [ ] **Fix the deployment test.**
      [`server/lifecycle/tao-contracts.test.ts:72-73`](../back-office/server/lifecycle/tao-contracts.test.ts#L72-L73):
      drop `governance.owner()`, and expect `registry.owner()` to be `ZeroAddress`.
      Consider asserting that a second `setGovernance` reverts.

- [ ] **Search for any other use** of `owner()`, `transferOwnership`,
      `setCertificateRegistry` or the three-argument governance `initialize` (server,
      web, scripts, infra) and update it.

- [ ] **Docs, once the bootstrap is changed.**
      [`contracts/README.md:109`](../contracts/README.md#L109) still says "Bootstrap
      hands both contracts from the development TAO key to the TAO's KMS key". Update it
      together with the bootstrap change, or tell the contracts side to update it.

- [ ] **EBSI templates.** `CertificateGovernance`'s initializer changed, so the
      `CertificateGovernance` and `CertificateRegistry` templates need a new version in
      the Proxy Templates Registry before production deployment. Coordinate with whoever
      submits templates to EBSI.

---

## 2. Rule changes are at least as strict as the decisions they govern

Covers the finding **"Under the pilot rules two roles can strip the veto and the timelock
from an approved revocation"**. The admin policy had no timelock, so two compromised roles
could rewrite the revocation policy and execute a revocation in one block, before the
supervisory authority could veto it.

### What changed in the contracts

- New invariant, enforced in `addTi`, when a policy change is proposed, and again when it
  is executed: the **ADMIN policy's timelock ≥ the timelock of SUSPEND, REVOKE and
  REINSTATE**, and **ADMIN's veto roles ⊇ every veto role of those policies**.
  A violation reverts with the new error **`AdminPolicyTooWeak()`**.
- `contracts/config/pilot.json` now has an **admin timelock of 86400 (24 h)**, the same
  as the revocation timelock. `production.json` already had it. Under the pilot rules,
  **a rule change no longer applies with the signature that completes its quorum**: it
  reaches `APPROVED` and has to be executed with `executeAdminProposal` after 24 h.
- The admin timelock may be 0 only when every other policy's timelock is 0. Only then
  does a rule change still apply immediately.
- The new error is already in the regenerated ABIs.

### To do

- [ ] **Update the built-in pilot rules.**
      [`server/lifecycle/ti-governance.ts:46`](../back-office/server/lifecycle/ti-governance.ts#L46):
      `admin.timelock: 0` → `86400`. Otherwise every `addTi` with the default rules
      reverts with `AdminPolicyTooWeak`. Update the doc comment above it (lines 36–39,
      "rule changes applied at quorum").

- [ ] **Update the test fixture.**
      [`server/lifecycle/fixtures/ledger.ts:74`](../back-office/server/lifecycle/fixtures/ledger.ts#L74):
      the ADMIN entry of `pilotPolicies` → `timelock: 86400`. Then fix the tests that
      expect a rule change to be `EXECUTED` right after its second signature. They should
      expect `APPROVED`, advance the ledger time by 24 h and call `executeAdminProposal`.
      Likely candidates are `console-governance.test.ts` and `web/tests/lifecycle-live.spec.ts`.

- [ ] **Validate rules before sending `addTi`** (optional, better errors).
      `tiRules()` in `ti-governance.ts` already checks veto roles. It could also check the
      invariant above, so that a bad `PLR_TI_GOVERNANCE_CONFIG` fails at startup instead
      of on-chain.

- [ ] **Translate the new error.**
      [`web/src/blockchain/governance.ts:679`](../back-office/web/src/blockchain/governance.ts#L679)
      maps contract errors to messages. Add `AdminPolicyTooWeak`, e.g. "Pravidlá pre
      zmenu pravidiel musia byť aspoň také prísne ako pravidlá rozhodnutí: rovnako dlhý
      časový zámok a veto pre každú rolu, ktorá môže vetovať rozhodnutie."

- [ ] **Delayed rule changes in the UI and the console.** Check every flow that proposes a
      rule change (signer rotation, policy and TTL changes). After the quorum is reached,
      it must show the change as waiting until `executableAt`, let a veto role cancel it
      meanwhile, and offer or perform `executeAdminProposal` afterwards. Watch for
      `AdminQuorumReached` instead of assuming `AdminProposalExecuted` follows at once.

- [ ] **TIs that already exist** (if any were set up with the old pilot rules, admin
      timelock 0). After the beacon upgrade they keep their policies. Any later change to
      a status policy is refused until ADMIN is raised. First raise ADMIN's timelock to at
      least the revocation timelock (under the old rules this change still applies at
      once).
