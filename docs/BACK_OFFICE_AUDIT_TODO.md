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
