# Governance contracts

Solidity for the registry's on-chain side: the certificate records every verifier
reads (`CertificateRegistry`) and the per-TI multisig that changes them
(`CertificateGovernance`, component 10 of the specification).

Built and tested with [Foundry](https://getfoundry.sh) (`foundryup --install
v1.8.5`); Node runs the scripts that write the interface for the other
components.

```bash
npm install                        # also the Solidity dependencies (forge soldeer install)
forge test                         # 203 tests (5 skipped)
node scripts/export-abi.js --check # the other components' copies of the interface are current
npm run compile                    # compiles, then regenerates those copies
```

Solidity dependencies (forge-std, OpenZeppelin) are Soldeer's: versions in
[`foundry.toml`](foundry.toml), pinned in `soldeer.lock`, fetched into
`dependencies/`. `remappings.txt` is kept by hand; after a version bump, change
the version in that library's line.

[`local/ebsi-mock/`](local/ebsi-mock/) holds the EBSI mock contracts, copied in
by hand. Tests and scripts import them as `ebsi-mock/…`; the contract may not,
which `FOUNDRY_PROFILE=prod forge build --skip test --skip script` checks on CI.

The interoperability test runs the back-office's TypeScript through `vm.ffi`
with Node 24, as the back-office itself runs (`npm ci` in `back-office/` once).
`PLR_NODE` names another interpreter; the default is `node`. Without a working
one the test is skipped with the reason locally, and fails on CI.

| File | What it holds |
|---|---|
| [`CertificateGovernance.sol`](contracts/CertificateGovernance.sol) | Component 10 — Certificate Governance Contract (multisig), one per TAO with its TIs inside. The deployable contract, composing the parts below |
| [`CertificateRegistry.sol`](contracts/CertificateRegistry.sol) | The certificate records and their standing, all a verifier reads |
| [`interfaces/`](contracts/interfaces) | One interface per module; `IGovernanceTypes` holds the shared types and errors, and `ICertificateGovernance` joins them all. A verifier needs only `ICertificateRegistry` |
| [`libraries/Roles.sol`](contracts/libraries/Roles.sol) | `Role` (one role, 1..8) and `RoleSet` (a set of roles, one bit each) |
| [`libraries/Hashes.sol`](contracts/libraries/Hashes.sol) | The hashes both languages compute: a certificate's id and record key, a reason's commitment |
| [`libraries/PolicyRules.sol`](contracts/libraries/PolicyRules.sol) | What a policy means for a set of roles |
| [`governance/TiAccreditation.sol`](contracts/governance/TiAccreditation.sol) | The EBSI registries the contract trusts, and whether a TI is active |
| [`governance/TiConfiguration.sol`](contracts/governance/TiConfiguration.sol) | Each TI's signers and their roles, cosigners, retired keys, policies, proposal lifetime |
| [`governance/Ballots.sol`](contracts/governance/Ballots.sol) | What both kinds of proposal share: signing, quorum, timelock, veto, expiry |
| [`governance/StatusProposals.sol`](contracts/governance/StatusProposals.sol) | Suspend, revoke, reinstate; audit verification (10.7) |
| [`governance/RuleChanges.sol`](contracts/governance/RuleChanges.sol) | The contract's own rule changes (10.4) |

Every module that holds state keeps it in its own ERC-7201
namespace (`plr.storage.<Module>`), so a module can grow across a beacon upgrade
without moving another's storage.

## Deployment reality check

The contract cannot be pushed to EBSI from here. EBSI is a permissioned
network, and deployment goes through the **Smart Contracts Factory**, which
accepts only pre-approved templates (component 10.0). The route is to check
whether an existing template already covers the case, then Design → Submit →
Deploy → Grant Access, plus the matching policy in the Trusted Policies
Registry. This contract is a template *candidate*.

What works today is the local Besu QBFT network in
[`../infra/besu/besu-qbft-network/`](../infra/besu/besu-qbft-network/). The full
sequence (the EBSI registry contracts first, then these) is in
[`docs/GUIDE.md`](../docs/GUIDE.md); in short:

```bash
cd ../infra/besu/besu-qbft-network && docker compose up -d
cd ../../../contracts && forge build && node scripts/export-abi.js
forge script scripts/DeployEBSI.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
GOVERNANCE_TAO_DID=did:ebsi:… npm run deploy:besu
```

The contract runs behind a beacon proxy, so it can be upgraded in place: the
deployment creates the implementation, an `UpgradeableBeacon` pointing at it
(owned by `GOVERNANCE_BEACON_OWNER`, on a development chain the deployer by
default) and a `BeaconProxy` that initializes itself as it is created. The
proxy is the contract's address; `deployments/<network>.json` records all
three. On a fresh chain, the first deployment from the first development
account puts the proxy at `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`, the
address the examples use (`0x5FbDB…0aa3`, the address before the proxy, is now
the implementation). To start the chain again, run
`docker compose down`, empty `data/validator1` to `data/validator4`, run
`docker compose up -d`, deploy, and run `infra/bootstrap.sh`. Bootstrap rotates
A and B to their KMS keys on the new contract. The back-office moves any open
case to the new contract by itself.

---

## Component 10 — CertificateGovernance

**It is how a certificate's standing changes.** There are no status lists: the
record in `CertificateRegistry` is the certificate's status. After registration a
record changes only when this contract executes a proposal (`applyExecuted`) or,
in an emergency, when one of the TI's signers suspends it at once (`suspendNow`:
reversible, and a revocation still needs the quorum). The contract proves that a
quorum approved a change before it happened.

Two consequences follow, and both are load-bearing:

- **Executing is applying.** `execute` writes the new standing to the record in
  the same transaction; the back-office only signs, submits and reconciles, and a
  verifier reads the record, never the back-office.
- **Nothing here identifies a holder.** A proposal carries only the
  certificate's `statusKey`, which is pseudonymous.

### Roles and policies

Every signer key holds one of the organisational roles of component 10.2:

| Role | Who | Number |
|---|---|---|
| A | the certification body's decision maker | 1 |
| B | the certification body's second approver | 2 |
| C | the supervisory authority | 3 |

**A quorum counts roles, not keys.** An organisation may hold several keys of
its role, for example a primary and a backup (component 10.9's key-loss
procedure). Those keys are still one voice, so "2 of 3" means two of the three
independent actors.

**A role and a set of roles are different types.** Inside the contract a role
is a `Role` and a set of roles a `RoleSet` (one bit per role, bit 0 for role
1), so the compiler refuses to take one for the other. Both are `uint8` in the
ABI, so there every set is named `...Mask` (`requiredRoleMask`,
`vetoRoleMask`, `rolesSignedMask`, `rolesPresentMask`) and a single role
`role`. `test/AbiExport.test.js` keeps it that way.

Each kind of decision has its own policy:

| Policy | Covers | Fields |
|---|---|---|
| `suspend`, `revoke`, `reinstate` | the status actions of component 10.3 | `threshold` (roles that must sign), `requiredRoleMask` (roles that must be among them), `vetoRoleMask` (roles that may veto; at least one must hold a key), `timelock` (seconds between quorum and execution) |
| `admin` | the contract's own rule changes | the same |

Component 10.2's alternative, the supervisory authority on every permanent
revocation, is the `revoke` policy with `requiredRoleMask` containing C.

### Flow

```
proposeAction(tiId, statusKey, actionType, reasonHash)
                                         counts as the proposer's signature
signProposal(id)                         until the action's policy is met
  └─ APPROVED, executable from executableAt (revocation: 24-48 h later)
execute(id)                              quorum checked again → ProposalExecuted
```

Two checks happen at `execute`. The quorum is checked again under the policy
then in force, and only signatures from keys that are still signers count, so
a removed key's signature stops counting. A proposal past the time to live can
no longer be signed or executed. A stale proposal for the same certificate is
expired when a new one is opened, instead of blocking it.

**A quorum regained restarts the timelock.** A quorum can be lost after it was
reached: a signer key is removed or replaced, or a stricter policy is adopted.
When a signature brings it back, `quorumReachedAt` is set to that moment and
`QuorumReached` is emitted again with the new `executableAt`. To the contract
that is a new decision, and it gets the full delay for a veto. Without that, a
quorum lost 47 hours into a 48-hour timelock and regained half an hour later
would be executable 30 minutes after the new approval. A signature that does
not change whether the policy is met (a third role signing, say) leaves the
timelock alone.

**A removed key is retired.** It can never be added again, as a new key or as
a replacement (`SignerRetired`). Re-adding it would revive its old signatures
without anyone signing, and a quorum regained that way would keep its original
timelock. A policy change that relaxes the rule again is itself a decision of
the rule-change quorum, with that policy's timelock and veto, and does not
restart a proposal's timelock.

### The veto, and why it is a single signer

`cancelProposal(proposalId, reasonHash)` can be called by **any one signer of
a role the policy gives the veto** (`vetoRoleMask`), including one who never
signed the proposal, and including during the timelock. The pilot gives the
veto to all three roles. A deployment can narrow it, so that one compromised
key of another role cannot stop every decision.

The key that opened a proposal may always withdraw it, whatever its role. That
is not a veto: it stops only what the same key started. The back-office relies
on it to close the on-chain side of a case it rejected.

`reasonHash` is a digest of the off-chain record of why, or zero. The
back-office sends the `entry_hash` of the audit-log entry that rejected the
case, so an auditor can go from the ledger to the record. It is never the hash
of a reason alone: a reason code has few values, and its hash would publish
it. `ProposalCancelled` and `ProposalExpired` both carry the certificate's
key, so its whole history can be read from events.

This is deliberate. Component 10.4 gives the timelock the job of protecting
against "a rash or compromised decision", and a timelock nobody can interrupt
protects against neither. If two roles are compromised, requiring a quorum to
cancel would hand the attacker the veto too. Letting the remaining honest
signer (in the pilot, the supervisory authority) stop execution alone is what
gives the delay its purpose.

The asymmetry is the point: approving is hard, stopping is easy. A wrongly
cancelled proposal can be reopened. A wrongly executed revocation cannot be
undone, because `REVOKED` is terminal in the back-office state machine.

### Self-administration

The rules change only through the contract's own quorum, under the `admin`
policy (component 10.4). Each change has its own function, so a signer's
wallet names what it is asked to approve:

| Function | Change |
|---|---|
| `proposeAddSigner(signer, role)` | a new key for a role |
| `proposeRemoveSigner(signer)` | refused if a policy could then no longer be met |
| `proposeReplaceSigner(signer, replacement)` | a key rotation in one step; the replacement takes the role |
| `proposePolicy(kind, threshold, requiredRoleMask, vetoRoleMask, timelock)` | one policy |
| `proposeProposalTtl(ttl)` | how long a proposal may stay open |

Then `signAdminProposal`, `executeAdminProposal`, `cancelAdminProposal` and
`expireAdminProposal`.

When the `admin` policy has no timelock, a change applies with the signature
that completes its quorum. When it has one, the change waits, and a signer of a
role the `admin` policy gives the veto may veto it in the meantime; its
proposer may withdraw it. The exception is the key a change removes or
replaces (`CannotVetoOwnRemoval`): a compromised key must not be able to block
its own rotation. The contract re-validates a change when it applies it,
against the configuration at that time. A removal that would leave a policy
unmet, or with no key that may veto under it, is refused (`Unsatisfiable`).

`getConfiguration()` returns everything in one read: signers with their roles,
the four policies, the proposal TTL, the roles that hold a key, and a version
that counts applied rule changes.

### Configuration files

[`scripts/Deploy.s.sol`](scripts/Deploy.s.sol) reads the initial rules from a
file chosen with `GOVERNANCE_CONFIG`:

| File | Rules |
|---|---|
| [`config/pilot.json`](config/pilot.json) (default) | 2 of 3 roles for everything; 24 h timelock on revocation; rule changes apply at quorum; every role may veto; proposals open for 30 days |
| [`config/production.json`](config/production.json) | as the pilot, but a rule change waits 24 h, so the supervisory authority can veto it |

Each policy in a file names its `requiredRoles` and its `vetoRoles` by letter.
`vetoRoles` has no default: a file that does not say who may veto does not
deploy.

| Variable | Default | Meaning |
|---|---|---|
| `GOVERNANCE_CONFIG` | `config/pilot.json` | the policies and the proposal TTL |
| `SIGNER_A` / `SIGNER_B` / `SIGNER_C` | the development mnemonic's first three accounts (development chains only) | the role keys; each role needs its own key |
| `GOVERNANCE_DEPLOYER_KEY` | the development mnemonic's first key (development chains only) | the key that pays for the deployment |
| `GOVERNANCE_NETWORK` | `ledger` | the deployment record's name on a chain other than the development ones |
| `BESU_RPC_URL` | `http://127.0.0.1:8545` | the local Besu network, for the `npm run …:besu` scripts |

The development chains are the local Besu network (chain 1337) and anvil
(31337), and their accounts come from the standard development mnemonic
([`scripts/Networks.sol`](scripts/Networks.sol)) on a private network.
Production signers are role keys in an HSM (component 10.4), never keys in a
repository.

On another ledger:

```bash
GOVERNANCE_DEPLOYER_KEY=0x… GOVERNANCE_CONFIG=config/production.json \
SIGNER_A=0x… SIGNER_B=0x… SIGNER_C=0x… \
  forge script scripts/Deploy.s.sol --rpc-url https://… --broadcast
```

The deployer's key only pays for the deployment. On any chain but the
development ones, `Deploy.s.sol` requires all three signers and the deployer's
key by name. It refuses the public development keys (the standard mnemonic's
first twenty accounts), and it warns when rule changes would apply without a
veto window. Without `--broadcast` it is a dry run and writes no deployment
record; `npm run deploy:local` is one, on an in-memory chain.

### One interface for every component

`npm run compile` also runs [`scripts/export-abi.js`](scripts/export-abi.js). It
writes the ABI, the enums (read from the Solidity source) and the role numbers
for the other components:

- the console, in [`back-office/web/src/blockchain/certificateGovernanceContract.ts`](../back-office/web/src/blockchain/certificateGovernanceContract.ts);
- the back-office, in [`back-office/shared/governance-contract.ts`](../back-office/shared/governance-contract.ts)
  and its JSON copy [`governance-contract.json`](../back-office/shared/governance-contract.json).

The contract's own bounds (`MAX_TIMELOCK`, `MAX_PROPOSAL_TTL`, `MAX_ROLE`) are
exported with the ABI, read from the source like the enums. None of the copies
restates the contract by hand. `test/AbiExport.t.sol` fails when a copy is
stale, or when the exported bounds differ from the deployed contract's. `node scripts/export-abi.js --check` does the same check
without writing anything.

### Audit verification (component 10.7)

A proposal names its certificate by the record's key:

```
certificateIdHash = SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", certificateId))
statusKey         = SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash))
```

The contract computes the key itself when a certificate is recorded, so a TI can
only take a key of its own. An auditor given the TI and the credential's id calls
`computeStatusKey(issuerDid, certificateId)`, compares the result with
`getProposal(id).statusKey`, and reads `certificateStatus` to confirm the
executed action stuck. No salt has to be disclosed, and the certification body's
systems are not needed. The function is read-only, so calling it costs nothing,
but a public RPC node sees what it is given: compute the key locally where that
matters.

A certificate has one key, so the one-open-proposal guard covers the whole
certificate, a suspension and a revocation of it can never be open at once, and
an auditor follows its history under one value.

The key is computed in two languages, and the reason's commitment too:
TypeScript in the back-office, Solidity here. If they ever diverged, a verifier or
an audit would fail while everything else kept working.
[`test/CommitmentInterop.t.sol`](test/CommitmentInterop.t.sol) guards against
that. It runs the real
[`back-office/server/issuance/protection.ts`](../back-office/server/issuance/protection.ts)
and compares it against the deployed contract, rather than asserting on a
hardcoded digest that could drift.

### The credential's hash

The record keeps `credentialHash`: SHA-256 of the signed JWT as the TI issued it,
everything before the first `~` of the SD-JWT. That part is the same in every
presentation, whichever attributes the holder discloses. A verifier hashes the
JWT it was shown and refuses a credential that does not match, so a stolen
credential signing key cannot put another holder or other attributes under a
real certificate's id, as long as the keys that write to this contract are safe.
The contract never sees the credential, so it neither checks the hash nor keeps
it unique.

### The reason

Every status proposal carries why it was made, as a commitment:

```
reasonHash = SHA-256(abi.encode("PLR-REASON-V1", reasonCode, reasonNote, salt))
```

`reasonCode` is the back-office's category (`conditions_not_met`,
`supervisory_decision`, …), `reasonNote` what it says in words, and the salt
256 bits of that proposal's own. A suspension and a revocation without one are
refused (`ReasonRequired`); only a reinstatement may give the zero hash. The
commitment is stored with the proposal, emitted in `ProposalCreated` and
returned by `getProposal`, so every signature is given under one reason that
nobody can change afterwards.

The reason itself does not go on chain, as component 10.3 has it. A readable
category would be linked to the holder by anyone who once saw their
credential: its record key follows from the TI's DID and the credential's id,
the record is public, and its standing changes in the same transaction as
`ProposalExecuted`. The salt is what keeps even a category
from showing; without it, a category has few enough values that its bare hash
would publish it. An auditor gets the category, the note and the salt from the
back-office (`POST registry/audit/reason-preimage`, recorded) and checks them
with `verifyProposalReason`, or recomputes them with `computeReasonHash`. The
interoperability test runs the back-office's `reasonCommitment` against the
contract as well.

### Wiring it to the back-office

The back-office sends to the ledger itself, through EBSI's Ledger API (Core API v1,
`POST /v1/ledger`): each transaction is signed in KMS and carries a token from the
Authorisation API whose scope covers it (`ledger:invoke` for these contracts, which
EBSI lists as Trusted Contracts). Reads need no token. In development, the EBSI
service in [`infra/ebsi-mock`](../infra/ebsi-mock) serves that API over the
contracts here.

Each TI decides with its own keys. Its A and B keys are secp256k1 keys in the
back-office's KMS, published as capabilityInvocation keys of the TI's DID; the
back-office signs only the exact call recorded beforehand: this contract, that
function with those arguments, this chain, no value, and only once
([`server/keys/ledger-signing.ts`](../back-office/server/keys/ledger-signing.ts)).
Role C belongs to the supervisory authority: any valid key of its DID signs, from
its own wallet; no part of this stack holds one (component 10.2). The TAO's key,
which owns both contracts, sets each TI up with `addTi`.

Collection records a certificate on the registry
([`server/issuance/governance-ledger.ts`](../back-office/server/issuance/governance-ledger.ts));
status decisions travel as proposals
([`server/lifecycle/governance.ts`](../back-office/server/lifecycle/governance.ts));
the console reads the contract directly and votes through the back-office or a
signer's wallet.

Enable it by pointing the back-office at the deployment:

```bash
export PLR_GOVERNANCE_CONTRACT=0x…   # CertificateGovernance
export PLR_CERTIFICATE_REGISTRY=0x…  # CertificateRegistry
export PLR_LEDGER_RPC_URL=https://api-pilot.ebsi.eu/v1/ledger
export PLR_LEDGER_CHAIN_ID=…
```

### Rotating signers

```bash
GOVERNANCE=0x… TARGET=0xRoleA,0xRoleB npm run rotate:besu
```

This makes `TARGET` the keys of roles A and B through the contract's own rule
changes. A role that has a key gets it replaced in one step
(`proposeReplaceSigner`), so the quorum never changes; a role without a key gets
one added. The script ([`scripts/RotateSigners.s.sol`](scripts/RotateSigners.s.sol),
its logic in [`SignerRotation.sol`](scripts/SignerRotation.sol)) approves each
change with the keys in `GOVERNANCE_APPROVER_KEYS` that are signers, under the
`admin` policy; on a development chain those default to the four genesis keys.
It tops up the new keys' gas (`MIN_BALANCE`, `TOP_UP`, in wei). It is idempotent
and never touches role C. It sends one transaction at a time (`--slow`), so a
signature never reaches the chain before its proposal.

With an `admin` timelock, each change waits, and the script prints when it can
be executed. The script is not a redeploy, on purpose: a new contract would
renumber the proposals that the back-office's case files point at.
`bootstrap.sh` runs it with the KMS role-key addresses.

### What the body's keys will sign

The contract lets its quorum change any rule. The back-office signs a rule
change with the certification body's keys only under a narrower policy: it may
make the rules stricter on its own, but loosening them needs the supervisory
authority to have signed first.
`POST registry/governance/admin/check` answers in advance.

[`scripts/SupervisorAdmin.s.sol`](scripts/SupervisorAdmin.s.sol) acts as the
supervisory authority in the pilot, with the development key that holds role C
(or `SUPERVISOR_KEY`). In production, the supervisory authority signs from its
own wallet.

```bash
GOVERNANCE=0x… ACTION=set_policy KIND=revoke THRESHOLD=2 REQUIRED=C VETO=A,B,C TIMELOCK=86400 \
  npm run supervisor:besu
GOVERNANCE=0x… SIGN=4 npm run supervisor:besu    # or EXECUTE=4, CANCEL=4
```

`npm run verify:besu` ([`scripts/VerifyOnchain.s.sol`](scripts/VerifyOnchain.s.sol))
prints the deployed contract's signers and policies, then runs a suspension to
execution, an audit verification, a revocation held by its timelock and a veto
of it, signing with the development keys. It belongs right after a deployment,
before bootstrap rotates A and B to their KMS keys.

## Known gaps

- Reconciliation is **polled, not subscribed**. `executedSince` exists, and the
  back-office reconciles per proposal (the `reconcile-governance-proposal`
  background task) plus a periodic `sweep-governance`, every
  `PLR_GOVERNANCE_RECONCILE_SECONDS` (default 120). Nothing subscribes to contract events in
  real time.
- The per-TI contracts are a new deployment: they cannot upgrade the earlier
  single-TI governance contract in place, whose interface differs. Later
  versions upgrade through the beacon.
- The contract has not had an external security review.
