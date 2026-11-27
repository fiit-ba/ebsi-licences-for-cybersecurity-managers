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

- [ ] **Check that role C is the supervisory authority.** The contract cannot tell who
      controls a cosigner's DID: a TAO that names a DID of its own holds C's vote and veto.
      Compare each TI's cosigner in role C (`getTi(tiId).cosigners`, `CosignersChanged`)
      with the supervisory authority's configured DID, show it in the TI view, and alert
      on any other DID. Offer the same view to the supervisory authority.

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

- [ ] **Closing a rejected case whose proposal was overtaken.** `cancelProposal(id,
      auditEntryHash)` reverts with `ProposalNotOpen` for an overtaken (or expired)
      proposal. Check the state first; if it reads `EXPIRED`, close it with
      `expireProposal(id)` (or leave it to the next proposal) and keep the audit entry's link
      off chain, since no `reasonHash` is recorded for it.

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

- Each TI has an **epoch**. `setCosigners` raises it whenever the list changes
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

---

## 8. A TI accredited again starts over

> Narrowed by §15: a return now ends only reinstatements and rule changes; suspensions and
> revocations go on.

Covers the finding **"A decision approved before a TI lost its accreditation executes
after it is accredited again"** (MEDIUM). A revocation approved just before the TI's
accreditation was revoked stayed `APPROVED` and executed at once when the TAO moved the TI
to a new attribute.

### What changed in the contracts

- `setTiAttribute` raises the TI's epoch (the one from §7) when the TI was **not**
  accredited under its previous attribute. Every proposal and rule change opened before is
  then expired, exactly as after a cosigner change (§7).
- Moving a TI that is still accredited ends nothing.
- Not covered, and documented: a revoked TAO whose chain the registry repairs under the
  same attributes brings its TIs back with no call to the contract; their open proposals go
  on. A veto still stops them.
- No ABI change.

### To do

- [ ] **Reconcile after a reaccreditation.** After `TiAttributeChanged` for a TI that had
      lost its accreditation, its open cases and rule changes read `EXPIRED` on chain.
      Close them as expired and let the TI decide again (new proposals, new signatures).
- [ ] **TAO console.** When moving a TI that is not accredited to a new attribute, warn that
      its open proposals, approved revocations included, will end.

---

## 9. A looser policy restarts the timelock

Covers the finding **"A lost quorum can come back without a signature and keep its old
timelock"** (MEDIUM). A quorum lost to a stricter policy came back when the policy was
relaxed, and the decision executed at once on its original `quorumReachedAt`.

### What changed in the contracts

- A rule change that **loosens** a policy (lower threshold, a required or veto role
  dropped, a shorter timelock, or a mix of stricter and looser) records when it took
  effect, per policy kind. Every decision of that kind approved before, even one that never
  lost its quorum, is executable at the earliest one full (new) timelock **after the
  change**; its lifetime follows (§13). `getProposal(...).executableAt` and `getAdminProposal(...).executableAt`
  already return the moved time.
- A stricter policy, a change of another kind, of the signers or of the lifetime moves
  nothing. Decisions without a timelock are not held back.
- No ABI change and no new event: the `PolicyChanged` event (with `AdminProposalExecuted`)
  marks the restart. `QuorumReached` / `AdminQuorumReached` are **not** emitted again.
- The other paths: a cosigner change ends the proposals (§7), a removed key is retired.
- Not covered, and documented: a key the DID Registry drops and lists again (a lapsed and
  renewed `capabilityInvocation`, a controller DID removed and re-added) brings its old
  signature back on the original timelock. A veto still stops it.

### To do

- [ ] **Re-read `executableAt` after a loosening.** Any view or job that caches a
      proposal's or rule change's `executableAt` (e.g. to schedule `execute` /
      `executeAdminProposal`) must refresh it for the TI after `PolicyChanged`; otherwise
      it calls too early and gets `TimelockNotElapsed`.
- [ ] **Warn before loosening.** When a policy-loosening rule change is proposed or
      executed, show the TI's approved decisions of that kind it will postpone (their
      lifetime is extended with them, §13).
- [ ] **Watch DID Registry key validity.** For each open, approved proposal, alert the veto
      holders when a key that signed it lapses in the DID Registry (its signature stops
      counting) and again when it is listed again (the signature, and possibly the quorum,
      returns on the original timelock). The contract cannot see either.

---

## 10. Only the TI's own keys register and suspend at once

Covers the finding that a cosigner's key registers and suspends for the TI. Any key
of a cosigner's DID (the supervisory authority, another TI named as a cosigner) could
suspend any valid licence of the TI alone, again after every reinstatement, and register a
TI's pending id first with a forged credential hash, so the TI's own registration failed
for good.

### What changed in the contracts

- `registerCertificate` asks `requireActiveOwnSigner`, `suspendNow` asks `requireOwnSigner`
  (no accreditation check, so a TI that lost its accreditation still withdraws its
  licences). Both accept any of the TI's own signer keys the DID Registry lists for the
  TI's DID, whatever its role, and refuse everything else with the new error
  **`NotAnOwnSigner`** (it was `NotASigner`).
- Opening a proposal (`proposeAction`) or any rule change (`propose*`) now asks
  `requireActiveOwnSigner` too (R6): a cosigner's key only signs and vetoes, and gets
  `NotAnOwnSigner` when it proposes.
- ABI: two new views, `requireOwnSigner(tiId, account)` and
  `requireActiveOwnSigner(tiId, account)`, and the error `NotAnOwnSigner`. The generated
  copies in `back-office/shared/` and `back-office/web/src/blockchain/` are regenerated.

### To do

- [ ] **Sign with a TI key.** Make sure `registerCertificate` and `suspendNow` are always
      sent with one of the TI's own keys (role A in the pilot), including the immediate
      suspensions a TAO or the RootTAO orders and the withdrawal after a TI loses its
      accreditation; never with the supervisory authority's key.
- [ ] **Pre-flight check.** Before sending either, call `requireOwnSigner` /
      `requireActiveOwnSigner` with the signing key, and map `NotAnOwnSigner` to a clear
      message (the key is not one of the TI's own keys, or the DID Registry no longer lists
      it).
- [ ] **Audit existing records.** For records written before this change, compare the
      signer in `CertificateRegistered` and in `CertificateStandingChanged` with
      `proposalId == 0` against the TI's own keys at that block. Flag any written or
      suspended by a cosigner's key: a forged registration binds the id to a credential hash
      the TI never issued and must be handled as an incident (the record cannot be
      rewritten).
- [ ] **NBÚ console.** If the supervisory authority's tools offered an immediate suspension,
      a proposal or a rule change with its own key, replace them with a request to the TI:
      NBÚ signs or vetoes what the TI's key opened.
- [ ] **Map `NotAnOwnSigner`** in the error handling of registration, immediate suspension
      and every `propose*` call.

---

## 11. No record starts revoked

Covers the finding that `registerCertificate` accepted any initial standing except
`NONE`, so one key could create a record already `REVOKED`: terminal, without the revoke
policy's quorum, timelock or veto.

### What changed in the contracts

- `registerCertificate` accepts only `VALID` (1) or `SUSPENDED` (2). `REVOKED` (3) and
  `NONE` (0) revert with `InvalidStanding()` (already in the ABI; no ABI change).
- A licence revoked before its record exists is registered `SUSPENDED` and then revoked by
  an ordinary `proposeAction(REVOKE)`: quorum, 24 h timelock in the pilot, veto.
- Only the TI's own keys register (§10), so a cosigner cannot take an id first; one of the
  TI's own keys still can, but at worst as `SUSPENDED`.

### To do

- [ ] **Register revoked-before-collection licences as suspended.**
      [`server/issuance/governance-ledger.ts:9`](../back-office/server/issuance/governance-ledger.ts#L9)
      maps `revoked` to `3n`, which now reverts. Send `suspended` (`2n`) for a licence whose
      local standing is `revoked`.
- [ ] **Open the revocation right after.** Once such a record is confirmed, open a
      revocation case (`proposeAction(REVOKE)`, with the original decision's reason hash)
      and let it go through the quorum and the timelock like any other. Until it executes,
      the ledger standing is `SUSPENDED`, not `REVOKED`.
- [ ] **Ledger standing after registration.**
      [`server/issuance/ledger-delivery.ts`](../back-office/server/issuance/ledger-delivery.ts)
      sets `ledger_standing=local_standing` after registering; for a locally revoked licence
      it must be `suspended` until the revocation executes. Reconcile from
      `CertificateRegistered` / `CertificateStandingChanged` rather than copying the local
      standing.
- [ ] **Tests.**
      [`server/lifecycle/precollection-lifecycle.test.ts:334`](../back-office/server/lifecycle/precollection-lifecycle.test.ts#L334)
      expects the record to be `revoked` right after registration; it will be `suspended`,
      then `revoked` once the revocation proposal executes. Fixtures that register with
      standing `3` must change too.
- [ ] **Operator view.** Show such a licence as "revocation pending" between registration and
      the executed revocation, and alert if the revocation proposal is vetoed or expires.

---

## 12. The proposal views return `expiresAt`

Covers the finding that neither `getProposal` nor `getAdminProposal` returned the end of
the lifetime a proposal opened with, so a client could only estimate it from the TI's
current `proposalTtl`, wrongly after a lifetime change.

### What changed in the contracts

- `ProposalView` and `AdminProposalView` have a new last field, **`uint64 expiresAt`**: the
  end of the lifetime fixed at opening. 0 for a proposal opened before it was stored (it
  never lapses by time).
- It is the latest end, not a promise: a changed standing (overtaken), a cosigner change or
  a restored accreditation can end a proposal sooner. **`state` (as `stateOf` /
  `adminStateOf`) is authoritative.**
- ABI change: the tuple returned by both views gains a field at the end. The generated
  copies are regenerated. Because the field is last and the tuple is dynamic, a decoder
  with the old 11 / 9 fields still reads them correctly.

### To do

- [ ] **Hand-written ABI.**
      [`server/lifecycle/governance.ts:67`](../back-office/server/lifecycle/governance.ts#L67)
      declares `getProposal`'s tuple by hand. It keeps working; add `uint64 expiresAt` at the
      end when the back-office needs it.
- [ ] **Show it, never estimate it.** Where a proposal or rule change is listed (console,
      web `blockchain/governance.ts`), show `expiresAt` and warn signers before an approval
      lapses. Never compute `proposedAt + proposalTtl`; and decide on `state`, not on
      `expiresAt`, since a proposal can end sooner.

---

## 13. An approval can always be carried out

Covers the finding that a quorum reached late (or regained late, or delayed by a policy
change) could make a decision executable only after its lifetime ended, so an approved
revocation expired silently.

### What changed in the contracts

- Once approved, a proposal stays open at least `MIN_SIGNING_WINDOW` (one day) past its
  `executableAt`, capped at `MAX_PROPOSAL_TTL` from its opening. It follows every move of
  `executableAt` while the proposal is open: a late quorum, a quorum regained by a
  signature, a looser policy that restarts the delay, a stricter one that lengthens it.
  Since §20 the end is stored at the quorum, and a change after it moves nothing.
- Signing, executing, vetoing and `expireProposal` / `expireAdminProposal` all use that end.
  A proposal that is not approved keeps the lifetime it opened with.
- `getProposal(...).expiresAt` and `getAdminProposal(...).expiresAt` (§12) return the
  extended end. No new event: the end moves with `QuorumReached`, `AdminQuorumReached` and
  `PolicyChanged`.
- No ABI change beyond §12.

### To do

- [ ] **Re-read `expiresAt`.** After `QuorumReached`, `AdminQuorumReached` or
      `PolicyChanged` for a TI, refresh the cached `expiresAt` of its open proposals;
      never compute it.
- [ ] **Expiry jobs.** Any job that expires or closes cases by time must read `state` /
      `expiresAt` from the chain, not its own copy of the TTL: an approved case may now stay
      open past `proposedAt + proposalTtl`.
- [ ] **Operator view.** Show an approved case past its original lifetime as "extended
      until …", and warn the signers and veto holders before the extension ends.

---

## 14. Every policy needs at least two roles

Covers the finding that a policy was well formed as soon as its threshold was not zero, so
`addTi` and `proposePolicy` accepted a threshold of one: a single key could then revoke
licences permanently or take over the TI's rules.

### What changed in the contracts

- New constant **`MIN_THRESHOLD = 2`** (`TiConfiguration`, exported in the generated
  `LIMITS`). `_requirePolicy` refuses a lower threshold with `InvalidPolicy()`, in `addTi`
  and for `proposePolicy`, when proposed and again when applied.
- Two keys of one role count once, so a TI needs two roles: two of its own, or one of its
  own and a cosigner's.
- `suspendNow` stays the only act of one signature.
- ABI: one new view, `MIN_THRESHOLD()`.

### To do

- [ ] **Validate `addTi` configurations too.**
      [`server/lifecycle/admin-policy.ts:67`](../back-office/server/lifecycle/admin-policy.ts#L67)
      enforces `min_threshold: 2` for rule changes only. Apply the same check to the policies
      [`server/lifecycle/ti-governance.ts`](../back-office/server/lifecycle/ti-governance.ts)
      sends to `addTi` (from the configuration file), and read the bound from the generated
      `LIMITS.MIN_THRESHOLD` instead of the literal 2.
- [ ] **Map `InvalidPolicy` at set-up.** A TI set up with a single role and no cosigner now
      fails at `addTi`; report it as "a TI needs at least two roles".

---

## 15. A TI without accreditation lowers trust, never raises it

Covers the finding that a TI that lost its accreditation could neither open nor execute any
proposal, so the revocation cases opened at a withdrawal could never complete and its
licences stayed `SUSPENDED` for good.

### What changed in the contracts

- `proposeAction` and `execute` ask the TIR only for **REINSTATE**. SUSPEND and REVOKE open
  and execute for a TI without accreditation, through its ordinary quorum, timelock and veto.
  Registration and rule changes still need an accredited TI (`TiNotActive`).
- A restored accreditation (`setTiAttribute`) no longer raises the epoch. It raises a new
  counter, and ends only the **reinstatements and rule changes** opened before it (they read
  `EXPIRED`). Suspensions and revocations go on; an executed revocation stays.
  A cosigner change still ends everything (§7).
- New view **`effectiveStatus(statusKey)`** on the registry: the record, the issuer's
  accreditation now (`Accreditation`: `UNKNOWN` 0, `ACCREDITED` 1, `NOT_ACCREDITED` 2), and
  `valid`, true only for `VALID`, `ACCREDITED` and now within `validFrom` / `validUntil`.
  `UNKNOWN` means the check could not be made (the governance call failed); a TIR error reads
  as `NOT_ACCREDITED`. `certificateStatus` stays the raw record.
- New view **`isAccredited(tiId)`** on governance, by the rule of `isActiveTi`.
- ABI: the two views, the `Accreditation` enum and the `EffectiveStatus` struct; generated
  copies regenerated (the enum is in the generated `ENUMS`).

### To do

- [ ] **Deliver the withdrawal cases.** The revocation cases opened when an accreditation is
      withdrawn can now be proposed and executed on chain; remove any guard that holds them
      back because the TI is not accredited, and let them run through the quorum.
- [ ] **Verifier: read `effectiveStatus`.**
      [`server/verification/credential.ts`](../back-office/server/verification/credential.ts)
      and [`server/verification/evaluate.ts`](../back-office/server/verification/evaluate.ts)
      read `certificateStatus`. Switch to `effectiveStatus`, refuse unless `valid`, and treat
      `NOT_ACCREDITED` and `UNKNOWN` as not valid (with their own reason codes).
- [ ] **Web view.** [`web/src/blockchain/governance.ts`](../back-office/web/src/blockchain/governance.ts)
      shows the raw standing; show the issuer's accreditation next to it.
- [ ] **Reinstatements after a return.** Reinstatement cases and rule changes opened before a
      TI lost its accreditation read `EXPIRED` after it is accredited again; close them and let
      the TI decide again. Revocation and suspension cases keep running.
- [ ] **No reinstatement without accreditation.** Hide or refuse the reinstatement action for a
      TI that is not accredited (`TiNotActive`).

---

## 16. Any signer closes an orphan proposal

Covers the finding that, under a narrowed veto, one key could block decisions about a
licence by opening a junk proposal: nobody else could open another proposal for it
(`ProposalAlreadyOpen`) or close the junk (`VetoNotAllowed`), not even after the key was
removed. Earlier fixes already cover most of it: an action must change the standing (§5), an
overtaken proposal is expired by the next one (§5), only the TI's own keys propose (§10).

### What changed in the contracts

- `cancelProposal` / `cancelAdminProposal` also accept **any signer of the TI** when the
  proposer holds no role now (removed, replaced, or unlisted in the DID Registry) **and** the
  signatures of live keys no longer meet the policy. A proposal a quorum still backs is
  stopped by the veto only, as before. No ABI change.
- Removing or replacing a key closes nothing by itself.
- Documented: the supervisory authority can no longer start a revocation on chain by itself;
  the TI's key opens it, NBÚ signs or vetoes.

### To do

- [ ] **Close orphans after a rotation.** After a `REMOVE_SIGNER` / `REPLACE_SIGNER`
      executes, list the open proposals and rule changes the old key opened; close those that
      no longer meet their policy (`cancelProposal` with any TI key, `reasonHash` = the audit
      entry), so their licences are free again. Re-propose what should go on.
- [ ] **A compromised key before its removal.** Under a narrowed veto, a key that still
      holds its role can keep a licence's only proposal slot (e.g. a junk REINSTATE of a
      suspended licence) until its removal executes. When a key is reported compromised,
      propose its removal at once, ask a veto holder to cancel its open proposals, and
      show the licence as blocked by that proposal until the slot is free.
- [ ] **NBÚ requests.** Give the supervisory authority a way to ask the TI to open a
      revocation (it cannot open one on chain), and show it the resulting proposal to sign.


---

## 17. A TI's accreditation ends on chain at its date

Covers the finding that a TI whose accreditation credential had expired, but whose attribute
was not yet revoked in the TIR, still acted on chain as fully accredited, while verifiers
already refused its licences. The contract cannot read the credential's dates (`attribData`).
The TAO now states the end, and the contract enforces it.

### What changed in the contracts

- **`addTi`**: `TiSetup` has a new last field, **`accreditedUntil`** (unix seconds). It must be
  in the future; `0` or a past time reverts with the new error **`InvalidAccreditedUntil`**.
- **`setTiAttribute(tiId, attributeId, accreditedUntil)`**: new third parameter, the same rule.
  It is also the **renewal** call: the same attribute with a later date. The TAO may also bring
  the date closer.
- A TI is accredited **until, not at,** `accreditedUntil`. Past it, `isAccredited`,
  `effectiveStatus` (`NOT_ACCREDITED`, `valid = false`) and every accreditation check behave
  as for a TI withdrawn in the TIR: `registerCertificate`, opening or executing a reinstatement,
  and rule changes revert with `TiNotActive`; `suspendNow`, suspensions and revocations still
  work. `isActiveTi(did, attributeId)` stays the TIR's answer only, without the date.
- A renewal of a TI whose date had passed counts as a **restoration**: its open reinstatements
  and rule changes read `EXPIRED` (as in §15). A renewal before the date ends nothing.
- A TI set up before this change reads `accreditedUntil = 0` and has **no end** until the TAO
  calls `setTiAttribute` with a date.
- **Events**: `TiConfigured(tiId, did, attributeId, accreditedUntil)` and
  `TiAttributeChanged(tiId, attributeId, accreditedUntil)`. Their signatures, and so their
  topics, changed.
- **Views**: `getTi(tiId)` returns `accreditedUntil` as the last field of `TiView`.
- ABI regenerated (`addTi` and `setTiAttribute` selectors, both events, `TiSetup`, `TiView`,
  the new error).

### To do

- [ ] **Send the date at setup.**
      [`server/lifecycle/ti-governance.ts`](../back-office/server/lifecycle/ti-governance.ts)
      builds the `TiSetup` for `addTi`. Add `accreditedUntil`: the TI's `accredited_until`,
      the same end as in its accreditation credential, in seconds. Never send `0`.
- [ ] **Cap it at the TAO's end.** The contract cannot see the TAO's own accreditation end.
      Before sending, check that the TI's date is not later than the TAO's `accredited_until`
      (as [`server/accreditation/invitations.ts`](../back-office/server/accreditation/invitations.ts)
      already does for the credential) and refuse otherwise.
- [ ] **Renew on chain.** When a TI's accreditation is renewed (a new credential, or a new
      attribute after a withdrawal), call `setTiAttribute(tiId, attributeId, newEnd)` with the
      same end as the new credential. Without it, the TI stops being accredited on chain at the
      old date.
- [ ] **Set dates on TIs that exist.** After the upgrade, call `setTiAttribute` once for every
      TI set up before it (`getTi(tiId).accreditedUntil == 0`), with its current attribute and
      end date.
- [ ] **Events and selectors.** Update the event parsing and the
      [`server/keys/ledger-signing.ts`](../back-office/server/keys/ledger-signing.ts) method
      map to the new `addTi` / `setTiAttribute` signatures and the new event topics.
- [ ] **Show the date and warn early.** Show `getTi(tiId).accreditedUntil` in the TI view, and
      remind the TAO before it passes. Past it, hide or refuse actions that raise trust (as in
      §15), and show `InvalidAccreditedUntil` / `TiNotActive` as readable errors.

---

## 18. A required role vetoes rule changes too

Follow-up to §2, from the review of its fix. The check left required roles out: with C
required on revocations but only A and B on the veto, A and B could drop C's requirement
with no say from C.

### What changed in the contracts

- `AdminPolicyTooWeak` now also requires **ADMIN's veto roles ⊇ every required role** of
  SUSPEND, REVOKE and REINSTATE, besides their veto roles and the longest timelock. Checked
  at `addTi`, when a policy change is proposed and again when it executes, on the whole set
  of policies. No ABI change.
- So a decision cannot require a role that ADMIN does not give a veto, and ADMIN cannot lose
  the veto of a role a decision requires.
- And ADMIN has a **timelock above 0 whenever a status policy requires a role**: without
  one, a change would apply at its quorum, before the required role could veto. An ADMIN
  policy without a timelock is now allowed only when no status policy has a timelock or a
  required role.

### To do

- [ ] **Policy editor.** Where a TI's rules are edited or proposed, add every required role
      of a status policy to ADMIN's veto roles, or refuse the change before sending it. A
      "require the supervisory authority on revocations" switch must keep C on ADMIN's veto
      and ADMIN's timelock above 0.
- [ ] **Error message.** Extend the `AdminPolicyTooWeak` message from §2: "…a veto for every
      role that may veto a decision or that a decision requires, and a time lock whenever a
      decision requires a role."
- [ ] **Existing TIs.** A TI set up before this change with a required role missing from
      ADMIN's veto, or with a required role and no ADMIN timelock, gets every policy change
      refused until a change of ADMIN fixes it. Check the configured TIs and propose that
      change first.

---

## 19. A later change of the same rule overtakes an earlier one

Covers the finding that a rule change approved earlier, neutral at the time and left
unexecuted, could be executed by one key after a later tightening of the same rule and undo
it, with no new quorum, timelock or veto window.

### What changed in the contracts

- A `SET_POLICY` change of a kind, or a `SET_PROPOSAL_TTL` change, opened **before** another
  change set the same policy (or the lifetime) is **overtaken**. It reads `EXPIRED` in
  `getAdminProposal` / `adminStateOf`; `signAdminProposal`, `cancelAdminProposal` and
  `executeAdminProposal` revert with `ProposalNotOpen`; anyone may close it with
  `expireAdminProposal` (`AdminProposalExpired`).
- Changes of other rules do not overtake it, and signer changes (`ADD_SIGNER`,
  `REMOVE_SIGNER`, `REPLACE_SIGNER`) are never overtaken, so parallel key rotations still all
  apply.
- A change opened in the same second in which its rule was set counts as later.
- New storage: one "set at" time per policy and one for the lifetime, after the TI's last
  field. No ABI change.

### To do

- [ ] **Show overtaken changes as expired.** Rule-change lists read the state from the
      contract; make sure an `EXPIRED` change that never reached its lifetime is shown as
      "overtaken by a later change of the same rule", not as timed out, and offer to close it
      (`expireAdminProposal`).
- [ ] **Do not queue competing changes.** When a policy or lifetime change is proposed while
      another change of the same rule is open, warn that executing one overtakes the other.
- [ ] **Stale drafts.** If the back-office keeps approved changes to execute later, re-read
      their state before sending `executeAdminProposal`; an overtaken one reverts with
      `ProposalNotOpen`.

---

## 20. An end once reached stays reached

Follow-up to §13, from the review of its fix. The end of an approved proposal was computed on
every read from the current `executableAt`, so a proposal that already read `EXPIRED`, and
that nobody had expired with `expireProposal`, came back when a later rule change moved its
`executableAt` past now (a loosening that restarts the delay, or a raised timelock). It then
executed on its old signatures, weeks after the back-office had closed the case.

### What changed in the contracts

- The end is **stored when the quorum is reached** (and again when it is regained by a
  signature): the lifetime's end, or a day past `executableAt` if later, capped at
  `MAX_PROPOSAL_TTL` from opening.
- A later change of the proposal's policy moves the end only if it was made **before** that
  stored end. One made at or after it moves nothing: the proposal stays `EXPIRED`.
- The same for rule changes (the ADMIN policy).
- Limit, on the safe side: the stored end is the one from the quorum. If one change of a
  policy extended an approved decision past that end, a second change of the same policy
  made after it ends the decision (it reads `EXPIRED` and must be proposed again).
- Compiler: `optimizer_runs` is now **1** (was 200) to make room for this under EIP-170.
  Calls cost 0.1 to 0.4 % more gas; the gas table in `contracts/README.md` is re-measured.
- No ABI change.

### To do

- [ ] **Trust `EXPIRED`.** A proposal or rule change that reads `EXPIRED` no longer comes
      back, so the back-office may close its case for good. Calling `expireProposal` /
      `expireAdminProposal` is still useful to free the certificate's slot and to leave an
      event, but it is no longer needed to keep the decision from returning.
- [ ] **Gas budgets.** If the back-office sets a gas limit per transaction, check it against
      the new figures in `contracts/README.md` (`signProposal` about 275,000, `addTi` about
      709,000).

## 21. A role signs a ballot once

Covers the finding that a ballot stored every signature of every key that held a role. A
cosigner's DID controller could list many keys in its DID document and sign with each. The
extra signatures changed nothing in the quorum, but every later signature, every execution
and every view walked the whole list, with a DID Registry call per entry, until signing grew
too expensive.

### What changed in the contracts

- `signProposal` and `signAdminProposal` refuse a key whose role already has a signature that
  counts on the ballot, with the new error **`RoleAlreadySigned()`**. A role counts once in
  the quorum, so no decision changes, and a ballot holds about one entry per role.
- The same key signing twice is still `AlreadySigned()`, checked first.
- A second key of the role can still sign once the first signature stops counting (its key
  removed, replaced or no longer listed in the DID Registry). Each such entry costs the
  controller a key it drops first, so the list can still grow, but only slowly.
- ABI: one new error, `RoleAlreadySigned()`. The copies in `back-office/shared/` and
  `back-office/web/src/blockchain/` are regenerated.

### To do

- [ ] **Explain the refusal.** Add `RoleAlreadySigned` to `refusalReasons()` in
      `back-office/web/src/blockchain/governance.ts`, for example
      "Za túto rolu už návrh podpísal iný kľúč."
- [ ] **Do not offer the signature.** Before sending `signProposal` / `signAdminProposal`,
      check the proposal view: if `rolesSignedMask` already contains the signer's role
      (`roleOf`), show who signed for that role instead of the sign button. This applies to a
      TI with a primary and a backup key in one role: only one of them signs a given proposal.
