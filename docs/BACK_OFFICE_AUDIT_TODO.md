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

---

## 3. Cosigners stand beside the TI, never in its place

Covers the finding **"TAO can name its own DIDs as cosigners and act as a TI's quorum"**.
`setCosigners` let the TAO name any DID in any role, including the roles of the TI's own
keys. Two DIDs the TAO controlled could meet a 2-of-3 policy alone.

### What changed in the contracts

- **No cosigner may hold a role that one of the TI's own keys holds.** Otherwise the
  call reverts with the new error **`CosignerHoldsSignerRole()`**.
- **The cosigners' roles together may not meet any policy's threshold** (distinct roles
  are counted). Otherwise the call reverts with the new error **`CosignersMeetAQuorum()`**.
- Both rules are checked in `addTi`, in `setCosigners`, and for the TI's own rule changes
  when proposed and when executed: `proposeAddSigner` with a cosigner's role, and
  `proposePolicy` with a threshold the cosigners would meet. With the pilot's single
  supervisory cosigner (role C), **no policy may have threshold 1**.
- **Event signature changed:** `CosignersChanged(bytes32 indexed tiId)` →
  `CosignersChanged(bytes32 indexed tiId, Cosigner[] cosigners)`. The topic hash is
  different. Nothing in the back-office listens to it today.
- **`addTi` now emits `CosignersChanged` too**, with the TI's initial cosigners (an empty
  list when it has none), before its `PolicyChanged` events. Nothing in the back-office
  parses `addTi`'s events today; a future receipt parser has to expect it.
- The new errors and the event are in the regenerated ABIs.

### To do

- [ ] **Translate the two new errors.**
      [`web/src/blockchain/governance.ts:679`](../back-office/web/src/blockchain/governance.ts#L679).
      Suggested texts:
      - `CosignerHoldsSignerRole`: "Spolupodpisovateľ nemôže mať rolu, ktorú má vlastný kľúč TI."
      - `CosignersMeetAQuorum`: "Spolupodpisovatelia by sami dosiahli kvórum. Prah politiky musí byť vyšší ako počet ich rolí."

- [ ] **Rule-change form.**
      [`web/src/features/governance/rules/RuleChangeForm.tsx`](../back-office/web/src/features/governance/rules/RuleChangeForm.tsx):
      when the TI has cosigners, don't offer a threshold ≤ the number of cosigner roles,
      or adding a signer in a cosigner's role. Either way, show the contract's error if
      the transaction is refused.

- [ ] **Check the TI setup.**
      [`server/lifecycle/ti-governance.ts:162`](../back-office/server/lifecycle/ti-governance.ts#L162)
      sets the supervisory authority as cosigner in role C, with keys in roles A and B.
      That still satisfies both rules. Make sure no configuration (`PLR_TI_GOVERNANCE_CONFIG`)
      used with a cosigner has a policy with threshold 1, otherwise `addTi` reverts.

- [ ] **Monitoring (optional).** If the back-office or an auditor's dashboard should alert
      on cosigner changes, subscribe to the new `CosignersChanged` event. It now carries
      the full list of DIDs and roles.

---

## 4. No key is both a TI key and a cosigner's key

Covers the finding **"Reachability counts a cosigner role that no key can sign with"**.
A TI could list the supervisory authority's key in its own DID document, add it as a key
of role B, and then give the veto to role C alone. Role C still counted as present, but
nobody could sign or veto as C any more.

### What changed in the contracts

- A key that the DID Registry lists for one of the TI's cosigner DIDs cannot become a TI
  key: `addTi`, `proposeAddSigner` and `proposeReplaceSigner` refuse it, and a rule
  change that adds or replaces a key is refused again at execution if that changed in
  the meantime.
- `setCosigners` and `addTi` refuse a cosigner DID that lists one of the TI's keys
  (including a key the TI's DID no longer lists).
- Both revert with the new error **`CosignerSharesSignerKey()`**, already in the
  regenerated ABIs.
- Accepted and documented: the supervisory authority can still list a TI key in its own
  DID document later. Only it can do that, and it only loses that key's voice as C.

### To do

- [ ] **Translate the new error.**
      [`web/src/blockchain/governance.ts:679`](../back-office/web/src/blockchain/governance.ts#L679).
      Suggested text: "Kľúč nemôže byť zároveň kľúčom TI a kľúčom spolupodpisovateľa."

- [ ] **Signer forms and rotation.** Where an operator enters a new or replacement key
      for a TI (rule-change form, signer rotation), show this error if the contract
      refuses it. Optionally check up front with `checkController(cosignerDid, key)` on
      the DID Registry for each cosigner of the TI.

- [ ] **Development seed and bootstrap.** Make sure no seeded TI key is also listed in
      the supervisory authority's DID (`scripts/seed-development.ts`). Otherwise
      `addTi` reverts.

- [ ] **Supervisory authority's key changes.** Before NBÚ adds a key to its DID document,
      check with `roleOf(tiId, key)` for each TI it cosigns that the key is no TI key (a
      TI could have registered a key whose public key leaked). If it is, NBÚ loses that
      key's voice as C.

- [ ] **TIs that already exist** (if any). After the beacon upgrade nothing re-checks
      them. Check once that no TI key is listed in any of its cosigners' DIDs; if one
      is, rotate it out with `proposeReplaceSigner`.

---

## 5. An action must change the certificate's standing

Covers two MEDIUM findings:

- **A reinstatement approved before an emergency suspension undoes it.** A REINSTATE
  could be opened and approved while a licence was still VALID, then executed days later
  to undo a `suspendNow` made for a key compromise.
- **`applyExecuted` records changes that did not happen.** A SUSPEND on a suspended
  certificate or a REINSTATE on a valid one moved `changedAt` and emitted
  `CertificateStandingChanged`. Now `changedAt` and that event mark only real changes.

### What changed in the contracts

- `proposeAction` accepts an action only if it changes the standing:
  **SUSPEND only a VALID certificate, REINSTATE only a SUSPENDED one, REVOKE either**.
  Otherwise it reverts with `CertificateNotValid()` (suspension) or the new
  **`CertificateNotSuspended()`** (reinstatement). A revoked certificate still gives
  `CertificateRevoked()`.
- The registry checks the same again in `applyExecuted`.
- **An overtaken proposal** (its action no longer changes the standing, e.g. a SUSPEND
  overtaken by `suspendNow`):
  - `stateOf` / `getProposal` report it as **`EXPIRED`** (5);
  - `signProposal`, `execute` and `cancelProposal` revert with `ProposalNotOpen()`;
  - the next `proposeAction` for the certificate expires it (emits `ProposalExpired`);
  - anyone may call `expireProposal` on it before its TTL.
  A REINSTATE is also overtaken when the certificate's standing changed after it was opened,
  so one opened on a VALID certificate before the upgrade never lifts a later suspension.
- **Registry ABI change:** `requireChangeableBy(statusKey, tiId)` →
  `requireChangeableBy(statusKey, tiId, actionType)`. The back-office does not call it.

### To do

- [ ] **Translate the new error.**
      [`web/src/blockchain/governance.ts:679`](../back-office/web/src/blockchain/governance.ts#L679).
      Suggested text for `CertificateNotSuspended`: "Obnoviť možno iba pozastavený
      certifikát." Check that `CertificateNotValid` also reads well for a proposal ("Pozastaviť
      možno iba platný certifikát.").

- [ ] **Propose only when the action fits.**
      [`server/lifecycle/governance.ts`](../back-office/server/lifecycle/governance.ts)
      `advance()` reads `certificateStatus` before `proposeAction`. Compare the standing with
      the case's action, and leave the case waiting instead of failing: a reinstatement case
      waits until its suspension is confirmed on chain (standing 2). Before, a reinstatement
      that reached the ledger first was a harmless no-op; now it reverts. **Decisions on one
      certificate must reach the ledger in order.**

- [ ] **Reconcile overtaken proposals.** A suspension case whose certificate was meanwhile
      suspended with `suspendNow` now reads `EXPIRED` on chain. Close it as already done
      (the certificate is suspended), not as failed, and don't retry it. Watch for
      `ProposalExpired` emitted by a later `proposeAction` or `expireProposal`.

- [ ] **Reinstatement UI.** Offer a reinstatement only for a suspended licence, and a
      suspension only for a valid one.

---

## 6. A signature counts only in the role it was given in

Covers the finding **"Past signatures are reread under the role their key resolves to
now"** (MEDIUM). A removed TI key that a cosigner's DID listed, a cosigner whose role the
TAO changed, or a cosigner key that became a TI key had its old signatures counted in a
role nobody signed with.

### What changed in the contracts

- Each ballot records the role a signature was given in (the role `ProposalSigned` and
  `AdminProposalSigned` already carry). A signature counts only while its key still
  resolves to that same role; otherwise it is dropped, never counted as another role.
- `rolesSignedMask` in `getProposal` / `getAdminProposal` reflects that. No ABI change.
- Ballots stored before the upgrade have no recorded roles; their signatures count as
  their key's role now, as before, until those ballots close or expire.

### To do

- [ ] **Signature lists in the UI and audit exports.** Show each signature with the role
      from its `ProposalSigned` / `AdminProposalSigned` event, and mark a signature whose
      role is missing from the current `rolesSignedMask` as no longer counting, rather than
      inferring roles from the signer's current role.

---

## 7. A cosigner change ends the TI's open proposals

Covers the finding **"The TAO can take the supervisory authority's veto from a pending
decision"** (MEDIUM). The TAO could remove NBÚ as cosigner while a rule change or a
revocation waited out its 24 h timelock, execute it, and name NBÚ again.

### What changed in the contracts

- Each TI has a **cosigner epoch**. `setCosigners` raises it whenever the list changes
  (a cosigner added, removed, given another role, or reordered). Sending the same list
  again does not.
- Every status proposal and rule change records the epoch it opened in. One from an
  earlier epoch is **expired**:
  - `stateOf`, `getProposal`, `adminStateOf`, `getAdminProposal` report `EXPIRED` (5);
  - signing, executing and cancelling it revert with `ProposalNotOpen()`;
  - anyone may call `expireProposal` / `expireAdminProposal` on it at once;
  - the next `proposeAction` for its certificate expires it (emits `ProposalExpired`).
- Deliberate and documented: by changing cosigners the TAO ends **every** pending decision
  of the TI, approved revocations and rule changes included.
- No ABI change. `CosignersChanged` (with the full list since §3) marks the moment.

### To do

- [ ] **Reconcile ended proposals.** After `CosignersChanged` for a TI, every open case and
      rule change of that TI reads `EXPIRED` on chain. Close them as expired, and offer to
      propose them again under the new cosigners (with fresh signatures), instead of
      retrying the old ids.
- [ ] **Warn the TAO operator.** Before `setCosigners`, show how many open proposals and
      rule changes of the TI it will end, approved revocations included, and ask for
      confirmation.
- [ ] **Supervisory authority's monitoring.** Alert NBÚ on `CosignersChanged` that removes
      it or changes its role, and on the proposals that change ended.
- [ ] **Signer rotation.** A rotation whose rule changes are waiting out their timelock is
      ended by a cosigner change; the rotation has to be run again.
