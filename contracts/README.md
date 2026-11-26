# Governance contracts

Solidity for the registry's on-chain side: the certificate records every verifier
reads (`CertificateRegistry`) and the per-TI multisig that changes them
(`CertificateGovernance`, component 10 of the specification).

Built and tested with [Foundry](https://getfoundry.sh) (`foundryup --install
v1.8.5`); Node 24 runs the script that writes the interface for callers. The
package builds and tests on its own: nothing it compiles, tests or reads lies
outside this directory.

```bash
npm install                        # also the Solidity dependencies (forge soldeer install)
forge test                         # 210 tests; test/integration/ (5 suites) skips without a deployed chain
node scripts/export-abi.js --check # the generated interface in abi/ is current
npm run compile                    # compiles, then regenerates it
make integration                   # deploys everything to a fresh anvil, then runs test/integration/
```

Solidity dependencies (forge-std, OpenZeppelin) are Soldeer's: versions in
[`foundry.toml`](foundry.toml), pinned in `soldeer.lock`, fetched into
`dependencies/`. `remappings.txt` is kept by hand; after a version bump, change
the version in that library's line.

[`local/ebsi-mock/`](local/ebsi-mock/) holds the EBSI mock contracts, copied in
by hand. Tests and scripts import them as `ebsi-mock/…`; the contract may not,
which `FOUNDRY_PROFILE=prod forge build --skip test --skip script` checks.

The hashes computed off chain as well (a certificate's status key, a reason's
commitment) have known answers in [`test/vectors/hashes.json`](test/vectors/hashes.json),
which [`test/HashVectors.t.sol`](test/HashVectors.t.sol) checks the contracts
against ([below](#audit-verification-component-107)). No test runs anything
outside Solidity, so `ffi` is off.

| File | What it holds |
|---|---|
| [`CertificateGovernance.sol`](contracts/CertificateGovernance.sol) | Component 10 — Certificate Governance Contract (multisig), one per TAO with its TIs inside. The deployable contract, composing the parts below |
| [`CertificateRegistry.sol`](contracts/CertificateRegistry.sol) | The certificate records and their standing, all a verifier reads |
| [`interfaces/`](contracts/interfaces) | One interface per module; `IGovernanceTypes` holds the shared types and errors, and `ICertificateGovernance` joins them all. A verifier needs only `ICertificateRegistry`. `IEbsiRegistries` is the part of EBSI's DID Registry and Trusted Issuers Registry the contract reads |
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

How the calls run between the two contracts and EBSI's registries is drawn in
[`docs/sequence-diagrams.md`](docs/sequence-diagrams.md).

## Deployment reality check

The contract cannot be pushed to EBSI from here. EBSI is a permissioned
network, and deployment goes through the **Smart Contracts Factory**, which
accepts only pre-approved templates (component 10.0). The route is to check
whether an existing template already covers the case, then Design → Submit →
Deploy → Grant Access, plus the matching policy in the Trusted Policies
Registry. This contract is a template *candidate*.

What works today is a local chain with EBSI's registry contracts on it, from
[`local/ebsi-mock/`](local/ebsi-mock/). `make integration` deploys them and
these contracts to a fresh anvil and runs the scenarios against them, with
nothing but this package. On anvil, and in the tests, the DID Registry and the
Trusted Issuers Registry stand at the addresses EBSI's PILOT network has them
at ([`scripts/PilotRegistries.sol`](scripts/PilotRegistries.sol)), so the
governance implementation, which keeps them as immutables, is the same
bytecode there as on the pilot; the local Besu network deploys them at fresh
addresses. In the Professional License Registry repository, the
local Besu QBFT network is `infra/besu/besu-qbft-network/`, and the full
sequence (the EBSI registry contracts first, then these) is in its
`docs/GUIDE.md`; in short, from this directory there:

```bash
(cd ../infra/besu/besu-qbft-network && docker compose up -d)
forge build && node scripts/export-abi.js
forge script scripts/DeployEBSI.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
GOVERNANCE_TAO_DID=did:ebsi:… npm run deploy:besu
```

`make deploy-besu` runs the same two deployments, against whatever Besu answers
at `BESU_RPC_URL`, and skips one whose record still has code at its address.

Both contracts run behind a beacon proxy, so each can be upgraded in place,
and both are deployed the way EBSI's factory deploys a template, against the
mock of it in [`local/ebsi-mock/contract-factory`](local/ebsi-mock/contract-factory).
For each contract, [`scripts/Deploy.s.sol`](scripts/Deploy.s.sol) creates the
implementation and a `VersionedUpgradeableBeacon` pointing at it (owned by
`GOVERNANCE_BEACON_OWNER`, on a development chain the deployer by default),
registers a template for them in the Proxy Templates Registry, and has the
Proxy Factory create the proxy, which initializes itself as it is created. The
registry goes first: governance is initialized with its address, and the TAO
then links the registry to governance (`setGovernance`), once: that call ends
the registry's ownership, so neither contract can be repointed. The proxies are the
contracts' addresses. `deployments/<network>.json` records each with its
implementation and beacon, and `deployments/<network>-ebsi.json` the EBSI
registries, which must be on the chain first.

A deployed contract knows no TI. Each TI is set up afterwards with `addTi`
([below](#one-contract-per-tao)): by the back-office, or by
[`scripts/AddTi.s.sol`](scripts/AddTi.s.sol) (`make add-ti-besu`).

In the Professional License Registry repository, to start the chain again, run
`docker compose down`, empty `data/validator1` to `data/validator4`, run
`docker compose up -d`, deploy, and run `infra/bootstrap.sh`. Bootstrap hands
both contracts from the development TAO key to the TAO's KMS key, and the
back-office then sets each TI up on the new contract with its KMS keys for
roles A and B.

## Going to production on EBSI

EBSI's Proxy Templates Registry refuses a template without an audit URI and a
repository URI, so both contracts need, before they can be registered as
templates:

- **an audit report covering both**, `CertificateGovernance` and
  `CertificateRegistry`, published at the template's `auditURI`;
- **a public repository** holding them, at the template's `repoURI`: this
  package, which builds and tests on its own as above.

Then, to deploy and run them:

- **a deployer** that holds the `ProxyFactory:deployProxy` policy in the
  Trusted Policies Registry and controls its DID in the DID Registry (here
  `GOVERNANCE_DEPLOYER_KEY` and `GOVERNANCE_DEPLOYER_DID`);
- **the TAO's DID accredited** in the Trusted Issuers Registry, as a TAO with a
  chain up to a Root TAO or as a Root TAO itself, and controlled by the TAO's
  key, which links the two contracts once at deployment (`GOVERNANCE_TAO_DID`,
  `GOVERNANCE_TAO`);
- **each certification body accredited as a TI** by that TAO, with its signer
  keys registered as controllers of the TI's DID, or of the cosigner's DID, in
  the DID Registry (`TI_DID`, `TI_ATTRIBUTE_ID`, `SIGNER_A`, `SIGNER_B`,
  `COSIGNER_DID`);
- **the proxies' owner**: the account that opts each proxy into a new
  implementation version, so never a development key. On EBSI the beacons are
  EBSI's and the owner is what `deployProxy` is given; the local deployment
  makes `GOVERNANCE_BEACON_OWNER` both.

### Gas

EBSI's PILOT network charges no gas; its production network does. Gas per
transaction, with a trust chain of two levels above the TI (a Root TAO, then
the TAO), as EBSI's review of these contracts measured it with the registry
code of EBSI's core, and as `make integration` measures it here with the
copies in `local/ebsi-mock/` (each receipt is left in `broadcast/`):

| Transaction | EBSI's review | `make integration` |
|---|---|---|
| deploying a proxy (`deployProxy`) | about 600,000 to 670,000 | 558,000 (registry), 576,000 (governance) |
| `registerCertificate` | about 270,000 | 339,000 |
| `addTi` | about 590,000 | 673,000 |
| a suspension through the quorum | about 750,000 | 1,000,000 |
| — `proposeAction` | 430,000 | 482,000 |
| — `signProposal` | 170,000 | 209,000 |
| — `execute` | 145,000 | 309,000 |

The figures also depend on the length of the DIDs and on the TI's signers and
cosigners. A longer trust chain costs more. `isActiveTi` reads the Trusted Issuers
Registry once per level above the TI, and the contracts ask it when a
certificate is recorded, when a proposal or a rule change is opened and when
one takes effect.

### Notes for the audit

- The scope is `contracts/`: `CertificateGovernance`, `CertificateRegistry` and
  the modules, interfaces and libraries they are built from. Everything else
  here (scripts, tests, `local/ebsi-mock/`) only deploys or exercises them.
- solc 0.8.26 through the IR pipeline, optimizer at 200 runs
  ([`foundry.toml`](foundry.toml)). `FOUNDRY_PROFILE=prod forge build --skip
  test --skip script` builds the contracts without the mocks.
- OpenZeppelin Contracts and Contracts Upgradeable 5.6.1, pinned in
  `soldeer.lock`: the version EBSI's core contracts are on. The contracts take
  only `OwnableUpgradeable` (with its `Initializable`) and `ERC165` from them.
- [`local/ebsi-mock/`](local/ebsi-mock/) is EBSI's registry and factory code,
  copied in for the tests and scripts. The contracts never import it; they
  read the registries through the minimal interfaces in
  [`contracts/interfaces/IEbsiRegistries.sol`](contracts/interfaces/IEbsiRegistries.sol).

---

## Component 10 — CertificateGovernance

**It is how a certificate's standing changes.** There are no status lists: the
record in `CertificateRegistry` is the certificate's status. After registration a
record changes only when this contract executes a proposal (`applyExecuted`) or,
in an emergency, when one of the TI's own keys suspends it at once (`suspendNow`:
reversible, and a revocation still needs the quorum). The contract proves that a
quorum approved a change before it happened.

**No record starts revoked.** `registerCertificate` accepts only `VALID` or
`SUSPENDED` (`InvalidStanding` otherwise). A licence revoked before its record
exists is registered `SUSPENDED` and then revoked by an ordinary proposal, so
every revocation takes the revoke policy's quorum, timelock and veto; one key
can at worst take an id first as `SUSPENDED`, which the quorum still decides.

**An action must change the standing** (`PolicyRules.changes`): a suspension
only of a valid certificate, a reinstatement only of a suspended one, a
revocation of either. Checked when proposed and again by the registry when
executed (`CertificateNotValid`, `CertificateNotSuspended`), so no reinstatement
approved while a certificate was valid can later undo an emergency suspension.
A proposal the standing has overtaken (a suspension after `suspendNow`) reads as
expired, takes no signature, and gives way to the next proposal; anyone may
expire it at once. It can no longer be vetoed or withdrawn either:
`cancelProposal` reverts with `ProposalNotOpen`, so no `reasonHash` is recorded
for it on chain (the overtaking `suspendNow` carries its own). A reinstatement lifts only a suspension it postdates, so one
opened before this rule on a valid certificate never lifts a later emergency
suspension. A record's `changedAt` and `CertificateStandingChanged` therefore
mark only real changes.

Two consequences follow, and both are load-bearing:

- **Executing is applying.** `execute` writes the new standing to the record in
  the same transaction; the back-office only signs, submits and reconciles, and a
  verifier reads the record, never the back-office.
- **Nothing here identifies a holder.** A proposal carries only the
  certificate's `statusKey`, which is pseudonymous.

### One contract per TAO

One contract serves every TI of a TAO. The TAO owns it and sets each TI up
with `addTi(TiSetup)`: the TI's DID, its accreditation attribute in the Trusted
Issuers Registry, its signer keys with their roles, its cosigners, its four
policies and its proposal lifetime. A TI is known by `tiId = keccak256(did)`
(`computeTiId`), and every proposal, signature and rule change names its TI.

The contract keeps a TI's rules and no status of its own. It asks EBSI's
registries two questions each time, so revoking there is enough:

- **Is the TI accredited?** `isActiveTi` reads the Trusted Issuers Registry:
  the TI's attribute is a `TI` accreditation by this contract's TAO, and every
  step above it is a `TAO`, up to a `RootTAO`, within `MAX_TRUST_CHAIN_DEPTH`
  (32) steps. It is asked when something that raises trust or changes rules
  starts or takes effect (recording a certificate, a reinstatement, a rule
  change), not of every signature. A TI without accreditation lowers trust
  but never raises it: `suspendNow`, and suspensions and revocations through
  its quorum, timelock and veto, do not ask, so it withdraws its certificates
  to the end. `isAccredited(tiId)` answers by the same rule, and adds the date
  below.
- **Has the accreditation ended?** Its validity period is in the credential
  the TIR stores as `attribData`, which the contract cannot read. The TAO
  states the end instead, as `accreditedUntil` in `addTi` and in
  `setTiAttribute`, and the contract trusts it. A TI is accredited until, not
  at, that time; past it, it is treated exactly like a TI withdrawn in the TIR.
  A date that has come, 0 included, is refused. The TAO's own end is not
  visible to the contract either, so **the TAO must cap every TI's date at the
  end of its own accreditation**. A TI set up before the date existed reads 0
  and has no end until the TAO sets one.
- **Is the key valid?** A signer key holds its role only while the DID
  Registry shows it as a capabilityInvocation key of the TI's DID
  (`checkController`). A key that registry no longer shows has no role, and
  its earlier signatures stop counting.

The TAO is its DID, not a key: the governance contract has no owner, and any
key the DID Registry shows, right now, as a capabilityInvocation key of the
TAO's DID acts as the TAO. A key the TAO rotates out of its DID document loses
the TAO's powers at once, and its replacement gains them at once; there is no
ownership to transfer, steal or recover. After `addTi` the TAO can replace a
TI's cosigners (`setCosigners`) and follow a TI to a renewed or new
accreditation with a new end date (`setTiAttribute`: a revoked attribute never
comes back). `TiConfigured` and `TiAttributeChanged` carry the date.

The two contracts are linked once, at deployment, and never repointed: a
contract set as the registry's governance decides every standing, so a key that
could repoint it would hold every certificate, quorum or not. Governance is
initialized with its registry, and the registry's owner (the TAO's key that
deployed the pair) links it with `setGovernance`, which refuses a governance
contract naming another registry and ends the registry's ownership. That check
is a sanity check, not authentication: any contract that names this registry
passes it. Until the link, the owner is a plain key, not gated by the DID
Registry (rotating the TAO's DID document does not remove it), and it could
still `transferOwnership`. The link is therefore a one-time trust in the key
that deploys the pair; `scripts/Deploy.s.sol` makes it right after deploying
both proxies. A registry linked to anything else is not recognised by
verifiers, who check through the Proxy Factory that its governance was deployed
from the governance template. Either contract's logic changes through its beacon, whose versions EBSI approves, not
by pointing at another contract. It cannot point the contract at other EBSI
registries: they are immutables of the implementation, given to its
constructor, so no transaction changes them. Their addresses never change on
EBSI, so a compromised TAO key cannot swap in registries of its own. Each
network deploys its own implementation with its own registries; should EBSI
ever move one, a new implementation version carries the change. A TI's signer keys, policies and proposal lifetime
change only through the TI's own quorum.

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

**A role can also belong to a cosigner.** A cosigner is a DID outside the TI
with a role (`Cosigner{did, role}`): any key the DID Registry shows for that
DID signs with the role, so the key rotates there and not here. The pilot's
role C is one, the supervisory authority's DID. A cosigner is never the TI's
own DID, and a DID is a cosigner once. A key that is one of the TI's own
signers signs with that role only.

**Cosigners stand beside the TI, never in its place.** The TAO names them
alone, at once (`setCosigners`), so a TAO key, compromised or not, could
otherwise name DIDs it controls in the TI's roles and decide for the TI. Two
rules keep them apart, checked when a TI is set up, when the TAO replaces the
cosigners, and for the TI's own rule changes when proposed and again when
applied:

- no cosigner holds a role one of the TI's own keys holds
  (`CosignerHoldsSignerRole`), so a key added for a cosigner's role is refused
  too;
- the cosigners' roles together meet no policy's threshold
  (`CosignersMeetAQuorum`), so a TI with cosigners cannot lower a threshold to
  their number either;
- no key is both a TI key and a key of a cosigner's DID
  (`CosignerSharesSignerKey`). A key resolves to one role, its TI role first,
  so otherwise the TI could list the supervisor's key in its own DID, adopt
  it, and keep role C counted as present with nobody able to sign or veto as
  C. Asked again when a key change executes, since the DID Registry may
  change meanwhile. Only the cosigner can still list a TI key in its own DID
  later; that costs it only that key's voice as C, so a cosigner adding a key
  first checks with `roleOf` that it is no TI key.

A quorum therefore always needs a key of the TI. And a cosigner only signs
and vetoes: what the TI starts or does alone takes one of its own keys.
Opening a status proposal or any rule change and `registerCertificate` ask
`requireActiveOwnSigner`, `suspendNow` asks `requireOwnSigner` (which works
after the TI lost its accreditation); both refuse a cosigner's key with
`NotAnOwnSigner`. Otherwise a cosigner could suspend any licence of the TI
again and again, or register a TI's id first with a hash the TI never
issued.

**The supervisor's independence rests on the TAO.** The contract cannot verify
who controls a cosigner's DID: it only asks the DID Registry which keys that DID
lists. A TAO that names a DID it controls holds signer C's vote and veto in that
TI. The rules above keep such a TAO from deciding alone, since a quorum still
needs a TI key, but not from approving or blocking with the TI what needs C.
That the cosigner in role C is the supervisory authority's DID is checked off
chain: `CosignersChanged` carries the full list of DIDs and roles, at `addTi`
and at every change, so the supervisory authority, or a monitor, follows a TI's
cosigners from the events alone.

**A cosigner change ends every open proposal of the TI.** Each TI has an
epoch, which `setCosigners` raises whenever the list changes (a cosigner
added, removed, given another role, or the order changed; the same list again
changes nothing). A proposal or rule change records the epoch it opened in, and one from
an earlier epoch is expired: it takes no signature, is not executed or
cancelled, anyone may expire it, and the next proposal for its certificate
replaces it. Otherwise the TAO could take the supervisory authority's veto
from a decision already under way (remove it during a 24 h timelock, execute,
name it again), or add a DID of its own to complete a decision one TI key
opened. The consequences are deliberate: by changing cosigners the TAO can end
any pending decision of the TI, an approved revocation included, and the TAO is
trusted to change cosigners only when no decision should be cut short.

**A restored accreditation ends what would raise trust.** `setTiAttribute`
counts each restoration of a TI that was not accredited under its previous
attribute or whose `accreditedUntil` had passed, and each ballot records the
count it opened with. A renewal before the end restores nothing. Reinstatements
and rule changes opened before a restoration are then expired, as above: they
could only have been opened before the loss, and are decided again.
Suspensions and revocations go on, since they could be executed during the
loss anyway, and an executed revocation stays in force. Moving a TI that is
still accredited, and the TI's own rule changes, leave proposals open. Not covered: a revoked TAO whose chain the registry repairs under the same
attributes brings its TIs back without any call to this contract, so their
proposals go on; a veto still stops them.

**A role and a set of roles are different types.** Inside the contract a role
is a `Role` and a set of roles a `RoleSet` (one bit per role, bit 0 for role
1), so the compiler refuses to take one for the other. Both are `uint8` in the
ABI, so there every set is named `...Mask` (`requiredRoleMask`,
`vetoRoleMask`, `rolesSignedMask`, `rolesPresentMask`) and a single role
`role`. [`scripts/export-abi.js`](scripts/export-abi.js) keeps it that way: it
refuses an interface that breaks the rule.

Each kind of decision has its own policy:

| Policy | Covers | Fields |
|---|---|---|
| `suspend`, `revoke`, `reinstate` | the status actions of component 10.3 | `threshold` (roles that must sign), `requiredRoleMask` (roles that must be among them), `vetoRoleMask` (roles that may veto; at least one must hold a key or a cosigner), `timelock` (seconds between quorum and execution) |
| `admin` | the contract's own rule changes | the same |

**No single key decides.** Every policy's `threshold` is at least
`MIN_THRESHOLD` (2 roles), at `addTi` and in every `proposePolicy`, when
proposed and again when applied (`InvalidPolicy` otherwise). Two keys of one
role are one role, so a TI needs two roles, its own or a cosigner's. The only
change to an existing licence's standing by one signature is the reversible
`suspendNow`. Registering a new licence (`registerCertificate`) is one signature
of one of the TI's own keys by design.

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

`execute` is called by a signer of the TI, and three checks happen there. The
TI must still be accredited. The quorum is checked again under the policy then
in force, and a signature counts only in the role it was given in, while its
key still holds that role: the signature of a key that was removed, that the
DID Registry no longer shows, or that now resolves to another role (a cosigner
whose role the TAO changed, a removed key a cosigner's DID lists) stops
counting, and is never reread as another role. And a proposal past the time to live can no longer be signed
or executed. A stale proposal for the same certificate is expired when a new
one is opened, instead of blocking it.

The time to live runs from the proposal's opening and covers its timelock, so
it is at least `MIN_SIGNING_WINDOW` (a day) longer than the TI's longest
timelock, and at most `MAX_PROPOSAL_TTL`. A proposal keeps the lifetime it
opened with, and a later change of the TI's lifetime does not touch it.

**An approval can always be carried out.** The bound above does not ensure a
quorum comes early enough: a revocation approved on day 29.5 of 30 would be
executable on day 30.5. So once approved, a proposal stays open at least
`MIN_SIGNING_WINDOW` (a day) past its `executableAt`, however that moved: a
late quorum, a quorum regained by a later signature, a looser policy that
restarts the delay, or a stricter one that lengthens it. The end is computed
on every read, never stored, so a rule change extends every approved decision
it delays. It is capped at `MAX_PROPOSAL_TTL` from opening, so losing and
regaining a quorum keeps nothing open for ever; past the cap an approval
lapses. Signing and the veto stay open as long as the proposal does.

`getProposal` and `getAdminProposal` return that end as `expiresAt` (0 for a
proposal opened before it was stored, which never lapses by time), so nobody
has to estimate it from the TI's current lifetime. It is the latest end, not a
promise: a changed standing, a cosigner change or a restored accreditation
ends a proposal sooner, and `state` (as `stateOf`) is what holds now.

**A quorum regained restarts the timelock.** A quorum can be lost after it was
reached: a signer key is removed, replaced or dropped from the DID Registry,
or a stricter policy is adopted.
When a signature brings it back, `quorumReachedAt` is set to that moment and
`QuorumReached` is emitted again with the new `executableAt`. To the contract
that is a new decision, and it gets the full delay for a veto. Without that, a
quorum lost 47 hours into a 48-hour timelock and regained half an hour later
would be executable 30 minutes after the new approval. A signature that does
not change whether the policy is met (a third role signing, say) leaves the
timelock alone.

A quorum can also come back without a signature, and the contract handles
each way it can see:

- **A looser policy** restarts the timelock of every decision of its kind
  approved before it, including one that never lost its quorum: it is
  executable one full timelock (the new one) after the change. A policy is
  looser unless it is at least as strict in every respect: threshold no
  lower, every required role and every veto role kept, timelock no shorter.
  A change that is stricter in one respect and looser in another counts as
  looser. A stricter policy, a policy of another kind, and a change of the
  signers or of the lifetime restart nothing. `executableAt` already shows
  the moved time; no `QuorumReached` is emitted again. The proposal's
  lifetime follows, to a day after the new `executableAt` (see above).
- **A change of cosigners** ends the TI's open proposals (see below).
- **A removed key** is retired and never comes back.

A key the DID Registry drops and lists again (a `capabilityInvocation` that
lapses and is renewed, possibly to the same public key, or a controller DID
removed and added back) is beyond the contract's sight: its signature returns
with no transaction, and the decision keeps its original timelock. A veto
still stops it while it waits.

**A removed key is retired.** It can never be added again, as a new key or as
a replacement (`SignerRetired`). Re-adding it would revive its old signatures
without anyone signing, and a quorum regained that way would keep its original
timelock.

### The veto, and why it is a single signer

`cancelProposal(proposalId, reasonHash)` can be called by **any one signer of
a role the policy gives the veto** (`vetoRoleMask`), including one who never
signed the proposal, and including during the timelock. The pilot gives the
veto to all three roles. A deployment can narrow it, so that one compromised
key of another role cannot stop every decision.

The key that opened a proposal may always withdraw it, whatever its role, for
as long as it holds one. That is not a veto: it stops only what the same key
started. The back-office relies on it to close the on-chain side of a case it
rejected.

**An orphan is closed by any signer.** Under a narrowed veto, a proposal whose
proposer no longer holds a role (removed, replaced, or no longer listed by the
DID Registry) would block its licence until it expires: only one proposal is
open per licence, the proposer cannot withdraw it and the other signers may not
veto it. So any signer of the TI may close such a proposal as long as no quorum
of live keys backs it; one that a quorum still backs stands, and only the veto
stops it. Removing a key closes nothing by itself: its proposals stay open until
someone closes them or they expire. Before its removal, the rule does not
apply: under a narrowed veto, a compromised key that still holds its role can
hold a licence's only open proposal, for example a reinstatement of a suspended
licence, until a veto holder cancels it or the key's removal executes (one
`admin` timelock). The licence stays suspended meanwhile, and a revocation can
be proposed once the slot is free. Only the TI's own keys open proposals
(R6), so the supervisory authority can no longer start a revocation on chain by
itself: it asks the TI, then signs or vetoes.

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

A TI's signer keys, policies and proposal lifetime change only through that
TI's own quorum, under its `admin` policy (component 10.4). Each change has its
own function, so a signer's wallet names what it is asked to approve:

| Function | Change |
|---|---|
| `proposeAddSigner(tiId, signer, role)` | a new key for a role; it must be a valid key of the TI's DID in the DID Registry |
| `proposeRemoveSigner(tiId, signer)` | refused if a policy could then no longer be met |
| `proposeReplaceSigner(tiId, signer, replacement)` | a key rotation in one step; the replacement, a valid key of the TI's DID, takes the role |
| `proposePolicy(tiId, kind, threshold, requiredRoleMask, vetoRoleMask, timelock)` | one policy; its timelock must leave `MIN_SIGNING_WINDOW` within the proposal lifetime, and `admin` must stay the strictest (below) |
| `proposeProposalTtl(tiId, ttl)` | how long a proposal may stay open, from `MIN_SIGNING_WINDOW` past the longest timelock up to `MAX_PROPOSAL_TTL`; it applies to proposals opened afterwards, an open one keeps the lifetime it opened with |

Then `signAdminProposal`, `executeAdminProposal`, `cancelAdminProposal` and
`expireAdminProposal`.

**Rule changes are at least as strict as the decisions they govern.** The
`admin` policy's timelock is at least the longest timelock of the `suspend`,
`revoke` and `reinstate` policies, and its veto roles include every veto role
and every required role of theirs (`AdminPolicyTooWeak` otherwise). This is checked when a TI is set
up, when a policy change is proposed and again when it applies, on the whole
set of policies, so neither side can be moved past the other. Otherwise the
keys a delay guards against could rewrite a decision's policy, stripping its
veto and its timelock, before the delay ran out: a rule change now never
applies before the decision it could weaken, and every role that may stop the
decision may stop the change too. A role a decision requires may veto rule
changes as well: with `revoke.requiredRoles = [C]` and only A and B on the
veto, A and B could otherwise drop C's requirement with no say from C. And
since a veto needs time, the `admin` policy has a timelock whenever a status
policy requires a role: without one, a change would apply with the signature
that completes its quorum, before C could veto.

When the `admin` policy has no timelock, which it may only when no other
policy has one or requires a role, a change applies with the signature that completes its
quorum. When it has one, the change waits, and a signer of a
role the `admin` policy gives the veto may veto it in the meantime; its
proposer may withdraw it. The exception is the key a change removes or
replaces (`CannotVetoOwnRemoval`): a compromised key must not be able to block
its own rotation. The contract re-validates a change when it applies it,
against the configuration at that time, and only while the TI is still
accredited.

**A later change of the same rule overtakes an earlier one.** A policy change
or a lifetime change opened before another change set the same policy, or the
lifetime, reads `EXPIRED`: it takes no signature or veto, cannot be executed,
and anyone may expire it (`expireAdminProposal`). Otherwise a change approved
long ago, neutral then, could be applied by one key on top of a later decision
and undo it, without a new quorum, timelock or veto window; a tightening
(for example C required on revocations) would be reversed without the
supervisory authority. Changes to other rules, and signer changes, are not
overtaken, so keys rotated in parallel all apply; a removed key never returns,
so a stale signer change cannot undo one. A change opened in the same second
in which its rule was set counts as later. A removal that would leave a policy unmet, or with no role that may
veto under it, is refused (`Unsatisfiable`); so is a replacement of the
cosigners by the TAO that would.

`getTi(tiId)` returns everything in one read: the TI's DID and accreditation
attribute, its signers with their roles, its cosigners, the four policies, the
proposal TTL, the roles that hold a key or a cosigner, and a version that
counts applied rule changes and the TAO's changes to the attribute or the
cosigners.

### Configuration files

A TI's initial rules come from a file. [`scripts/AddTi.s.sol`](scripts/AddTi.s.sol)
reads the one chosen with `GOVERNANCE_CONFIG`, and the back-office reads the
same format when it sets a TI up (`PLR_TI_GOVERNANCE_CONFIG`, the pilot's rules
by default):

| File | Rules |
|---|---|
| [`config/pilot.json`](config/pilot.json) (default) | 2 of 3 roles for everything; 24 h timelock on revocation and on rule changes; every role may veto; proposals open for 30 days |
| [`config/production.json`](config/production.json) | the same rules, as a starting point to narrow (for example `requiredRoles: ["C"]` on revocation) |

Each policy in a file names its `requiredRoles` and its `vetoRoles` by letter.
`vetoRoles` has no default: a file that does not say who may veto does not
deploy.

What [`scripts/Deploy.s.sol`](scripts/Deploy.s.sol) reads. The defaults of the
first six rows apply on a development chain only; elsewhere those variables
are required:

| Variable | Default | Meaning |
|---|---|---|
| `GOVERNANCE_DEPLOYER_KEY` | development key 0 | the key that pays for the deployment |
| `GOVERNANCE_TAO` | development key 4's account | a key of the TAO's DID: owns the registry until it links it to governance |
| `GOVERNANCE_TAO_KEY` | development key 4 | its private key: it links the registry to governance, once, and `AddTi.s.sol` sets a TI up with it |
| `GOVERNANCE_TAO_DID` | `did:ebsi:zDevelopmentTao` | the TAO's DID in the Trusted Issuers Registry |
| `GOVERNANCE_BEACON_OWNER` | the deployer | who owns both beacons, and so can upgrade both contracts |
| `GOVERNANCE_STORAGE_LAYOUT_HASH`, `REGISTRY_STORAGE_LAYOUT_HASH` | a hash of the implementation's code | the storage layout each beacon records for its implementation |
| `GOVERNANCE_TEMPLATE_VERSION` | `1` | the version both templates are registered under; bump it to register again under the same names |
| `GOVERNANCE_DEPLOYER_DID` | empty | the deployer's DID for the Proxy Factory |
| `GOVERNANCE_NETWORK` | `ledger` | the deployment record's name on a chain other than the development ones |
| `BESU_RPC_URL` | `http://127.0.0.1:8545` | the local Besu network, for the `npm run …:besu` scripts |

What [`scripts/AddTi.s.sol`](scripts/AddTi.s.sol) reads, besides
`GOVERNANCE_TAO_KEY`:

| Variable | Default | Meaning |
|---|---|---|
| `GOVERNANCE` | the address in `deployments/<network>.json` | the governance contract |
| `TI_DID`, `TI_ATTRIBUTE_ID` | none, required | the TI's DID and its accreditation attribute in the Trusted Issuers Registry |
| `SIGNER_A` / `SIGNER_B` / `SIGNER_C` | development keys 1, 2 and 5 (development chains only) | the TI's keys by role; a role left unset has no key, and C is not read when there is a cosigner |
| `COSIGNER_DID` | none | a DID that signs from outside the TI (the supervisory authority) |
| `COSIGNER_ROLE` | `C` | the cosigner's role |
| `GOVERNANCE_CONFIG` | `config/pilot.json` | the policies and the proposal TTL |

The development chains are the local Besu network (chain 1337) and anvil
(31337), and their accounts come from the standard development mnemonic
([`scripts/Networks.sol`](scripts/Networks.sol)) on a private network: key 0
deploys and owns the beacons, 1 and 2 are the TI's keys of roles A and B, 3 is
the RootTAO, 4 the TAO and 5 the supervisory authority.
[`scripts/SeedEbsi.s.sol`](scripts/SeedEbsi.s.sol) puts them in the EBSI mocks.
Production signers are role keys in an HSM (component 10.4), never keys in a
repository.

On another ledger, with its EBSI contracts named in
`deployments/<network>-ebsi.json`:

```bash
GOVERNANCE_DEPLOYER_KEY=0x… GOVERNANCE_TAO=0x… GOVERNANCE_TAO_KEY=0x… \
GOVERNANCE_TAO_DID=did:ebsi:… GOVERNANCE_BEACON_OWNER=0x… \
GOVERNANCE_STORAGE_LAYOUT_HASH=0x… REGISTRY_STORAGE_LAYOUT_HASH=0x… \
  forge script scripts/Deploy.s.sol --rpc-url https://… --broadcast

GOVERNANCE_TAO_KEY=0x… TI_DID=did:ebsi:… TI_ATTRIBUTE_ID=0x… \
SIGNER_A=0x… SIGNER_B=0x… COSIGNER_DID=did:ebsi:… \
GOVERNANCE_CONFIG=config/production.json \
  forge script scripts/AddTi.s.sol --rpc-url https://… --broadcast
```

The deployer's key only pays for the deployment. On any chain but the
development ones, `Deploy.s.sol` refuses a public development account (one of
the standard mnemonic's first twenty) as the TAO or the beacon owner, and
`AddTi.s.sol` refuses one as a signer. Without `--broadcast` `Deploy.s.sol` is
a dry run and writes no deployment record; `make deploy-besu DRY_RUN=1` is one.

### One interface for every caller

`npm run compile` also runs [`scripts/export-abi.js`](scripts/export-abi.js). It
writes both contracts' ABIs (`abi`, `registryAbi`), the enums (read from the
Solidity source), the role numbers and the contracts' own bounds
(`MAX_TIMELOCK`, `MAX_PROPOSAL_TTL`, `MIN_SIGNING_WINDOW`, `MAX_ROLE`, `MAX_TRUST_CHAIN_DEPTH`, read
from the source like the enums) to
[`abi/governance-contract.json`](abi/governance-contract.json). A caller takes
the interface from there rather than restating the contracts by hand.

In the Professional License Registry repository, where this package sits next
to the back-office, the script also writes the back-office's copies: the
console's `back-office/web/src/blockchain/certificateGovernanceContract.ts`,
and the server's `back-office/shared/governance-contract.ts`
(`GOVERNANCE_ABI`, `REGISTRY_ABI`) with its JSON twin. On its own, the
package has only `abi/`.

`node scripts/export-abi.js --check` fails when a copy is stale, without
writing anything; `npm test` runs it after `forge test`.
[`test/AbiExport.t.sol`](test/AbiExport.t.sol) reads `abi/` and fails when
the exported bounds differ from the deployed contract's, or when a proposal
carries anything beyond its certificate's key and neutral metadata.

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

The key is computed off chain too, and the reason's commitment: by the
issuer's back-office, and by whatever a verifier uses. If an implementation
ever diverged from the contracts, a verifier or an audit would fail while
everything else kept working. [`test/vectors/hashes.json`](test/vectors/hashes.json)
holds known answers for both, computed independently of the Solidity by
[`test/vectors/generate.py`](test/vectors/generate.py) (its own ABI encoder and
Python's standard library), in cases chosen to catch encoding mistakes:
diacritics, a DID and an id that concatenate alike, strings longer than one ABI
word, an empty note, a note that ends in a space. [`test/HashVectors.t.sol`](test/HashVectors.t.sol)
checks the contracts against them, and every other implementation checks
itself against the same file; the Professional License Registry's back-office
does.

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
known answers in `test/vectors/hashes.json` cover the commitment as well.

### Wiring it to the back-office

The back-office sends to the ledger itself, through EBSI's Ledger API (on the pilot
`POST /ledger/v4/blockchains/besu`; in Core API v1 `POST /v1/ledger`): each transaction
is signed in KMS and carries a token from the Authorisation API whose scope covers it
(`ledger_invoke` on the pilot, `ledger:invoke` in Core API v1, for these contracts,
which EBSI lists as Trusted Contracts). Reads need no token. In development, the
Professional License Registry's EBSI service (`infra/ebsi-mock` in that
repository) serves that API over the contracts here. The paths below are in
that repository too.

Each TI decides with its own keys. Its A and B keys are secp256k1 keys in the
back-office's KMS, which the TI lists as capabilityInvocation keys of its own DID; the
back-office signs only the exact call recorded beforehand: this contract, that
function with those arguments, this chain, no value, and only once
(`back-office/server/keys/ledger-signing.ts`).
Role C belongs to the supervisory authority: any valid key of its DID signs, from
its own wallet; no part of this stack holds one (component 10.2). The TAO's key,
which owns both contracts, sets each TI up with `addTi`.

Collection records a certificate on the registry
(`back-office/server/issuance/governance-ledger.ts`); status decisions travel
as proposals (`back-office/server/lifecycle/governance.ts`);
the console reads the contract directly and votes through the back-office or a
signer's wallet.

Enable it by pointing the back-office at the first deployment and at EBSI's Proxy
Factory, through which it deploys every further TAO's pair from the same templates
(the RootTAO deploys, the TAO's own key owns the pair):

```bash
export PLR_GOVERNANCE_CONTRACT=0x…   # CertificateGovernance
export PLR_CERTIFICATE_REGISTRY=0x…  # CertificateRegistry
export PLR_PROXY_FACTORY=0x…         # EBSI's ProxyFactory
export PLR_LEDGER_RPC_URL=https://api-pilot.ebsi.eu/ledger/v4/blockchains/besu
export PLR_LEDGER_CHAIN_ID=…
```

### Rotating signers

```bash
GOVERNANCE=0x… TI_DID=did:ebsi:… TARGET=0xRoleA,0xRoleB npm run rotate:besu
```

This makes `TARGET` the keys of the TI's roles A and B through its own rule
changes. A role that has a key gets it replaced in one step
(`proposeReplaceSigner`), so the quorum never changes; a role without a key gets
one added. Each new key must already be a valid key of the TI's DID in the DID
Registry. The script ([`scripts/RotateSigners.s.sol`](scripts/RotateSigners.s.sol),
its logic in [`SignerRotation.sol`](scripts/SignerRotation.sol)) approves each
change with the keys in `GOVERNANCE_APPROVER_KEYS` that are signers, under the
`admin` policy; on a development chain those default to development keys 0 to 3.
It tops up the new keys' gas (`MIN_BALANCE`, `TOP_UP`, in wei). It is idempotent
and never touches role C. It sends one transaction at a time (`--slow`), so a
signature never reaches the chain before its proposal.

With an `admin` timelock, each change waits, and the script prints when it can
be executed. The changes of one run wait side by side, so none is approved by a
role another of them rotates: the first to apply would retire that role's key
and its signature on the rest. Rotating A and B at once therefore takes role
C's approval too; without it, rotate one role per run. A role the `admin`
policy requires has to be among the approvers and not rotated in the same run,
or the script stops before sending anything (`RequiredApproversMissing`). The script is not a redeploy, on purpose: a new contract would
renumber the proposals that the back-office's case files point at. Bootstrap
does not need it: the back-office sets a TI up with its KMS role keys from the
start.

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
GOVERNANCE=0x… TI_DID=did:ebsi:… ACTION=set_policy KIND=revoke THRESHOLD=2 REQUIRED=C VETO=A,B,C TIMELOCK=86400 \
  npm run supervisor:besu
GOVERNANCE=0x… TI_DID=did:ebsi:… SIGN=4 npm run supervisor:besu    # or EXECUTE=4, CANCEL=4
```

`npm run verify:besu` ([`scripts/VerifyOnchain.s.sol`](scripts/VerifyOnchain.s.sol))
prints the development TI's signers and policies, records a certificate, then
runs a suspension to execution, an audit verification, a revocation held by
its timelock and a veto of it, signing with the development keys. It needs the
development TI set up with those keys first (`SeedEbsi.s.sol`, then
`AddTi.s.sol`); a TI the back-office set up signs with KMS keys the script does
not hold. `make integration` runs the whole sequence on a fresh anvil, then
the scenarios in [`test/integration/`](test/integration).

## Known gaps

- Reconciliation is **polled, not subscribed**. The back-office reconciles per
  proposal (the `reconcile-governance-proposal` background task) plus a
  periodic `sweep-governance`, every `PLR_GOVERNANCE_RECONCILE_SECONDS`
  (default 120). Nothing subscribes to contract events in real time.
- This version is a new deployment: it cannot upgrade the earlier single-TI
  governance contract in place, whose interface differs. Later versions
  upgrade through the beacon.
- There is no audit report yet. EBSI has reviewed the contracts, but it
  registers them as templates only with an audit of both
  ([above](#going-to-production-on-ebsi)).
- Who owns the proxies in production, and so opts them into a new
  implementation version, and how long an upgrade waits, are not decided yet.

## Licence

MIT, see [`LICENSE.md`](LICENSE.md). [`local/ebsi-mock/`](local/ebsi-mock/) is
EBSI's code and keeps EBSI's licence, the EUPL 1.2, as each of its files says.
