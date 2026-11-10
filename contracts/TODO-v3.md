# Contracts: tasks

The plan was a member model: members with keys per role, a floor of minimum
rules, key recovery. What was built is the simpler per-TI model: one contract
pair per TAO, each TI inside it with its own signers, cosigners and policies. The
sections of the member model are folded into **Done** and **Open** below, under
their first IDs.

## T. Move from Hardhat to Foundry

Before v3, on the current contract, so v3 starts from a green suite.

- [x] **T1** `foundry.toml`: solc 0.8.24 (0.8.26 since, as EBSI's contracts
      use), optimizer 200 runs, `src`,
      `test`, `out`, `ffi = true`, `build_info = true`,
      `extra_output = ["storageLayout"]`, `fs_permissions` to read
      `config/`; `out/` and `cache/` in `.gitignore`.
- [x] **T2** Solidity dependencies through Soldeer (npm refuses git
      packages, and forge-std is not on npm): `forge-std` 1.17.0,
      OpenZeppelin `contracts` and `contracts-upgradeable` 5.7.0,
      `openzeppelin-foundry-upgrades` 0.4.2; `soldeer.lock`, hand-kept
      `remappings.txt`. P adds `@openzeppelin/upgrades-core` through npm,
      which the upgrades library runs.
- [x] **T3** `export-abi.js` reads `out/` and writes the ABI in one canonical
      order, so the generated copies did not change; `npm run compile` =
      `forge build && node scripts/export-abi.js`, `npm test` builds first.
- [x] **T4** Tests in Solidity, 79 cases, all green: `GovernanceTest` (the
      fixture, pilot policies from `config/pilot.json`),
      `CertificateGovernance.t.sol`, `ThresholdChange.t.sol`,
      `RotateSigners.t.sol` (rotation now in `scripts/SignerRotation.sol`,
      for T5 too), `CommitmentInterop.t.sol` (Python through `vm.ffi`;
      skipped locally without `eth_abi`, fails on CI), `AbiExport.t.sol`
      (proposal fields, limits). The staleness check and the role-naming
      rule moved into `node scripts/export-abi.js --check`.
- [x] **T5** `scripts/Deploy.s.sol` and `scripts/RotateSigners.s.sol` (with
      `--slow`), sharing `GovernanceConfigFile.sol` (config/*.json, also the
      test fixture's) and `Networks.sol` (development chains 1337 and 31337,
      the development mnemonic). Every check of `deploy.js` kept; tried
      against anvil: deploy, rotation with top-up, a repeated rotation sending
      nothing, and each production refusal. `npm run deploy:besu`,
      `deploy:local` (dry run), `rotate:besu`. Changed: `deployedAt` and
      `rotatedAt` are Unix seconds; MIN_BALANCE and TOP_UP are in wei; the
      approvers are `GOVERNANCE_APPROVER_KEYS`. `verify-onchain.js` and
      `supervisor-admin.js` stay until J.
- [x] **T6** CI job "Governance contract (Foundry)": `foundry-toolchain`
      pinned to v1.8.5, `npm ci` (its postinstall runs `forge soldeer
      install`), `forge build`, `forge test` (CI=true, so the interop test
      fails rather than skips without eth_abi), `export-abi.js --check`, and
      the Hardhat suite until T8 (dropped there).
- [x] **T7** `infra/bootstrap.sh` checks for forge and the dependencies, then
      runs `npm run rotate:besu`; the compose comment, `contracts/README.md`,
      `GUIDE.md` (Foundry in the prerequisites, the tests, the supervisor's
      key given whole) and `frontend/README.md`. `npm test` = forge test,
      the export check (and, until T8, the Hardhat suite).
- [x] **T8** Hardhat removed: `hardhat.config.js`, both npm packages (the
      Node scripts need none now), the JS tests and the JS scripts.
      `supervisor-admin.js` and `verify-onchain.js` became
      `SupervisorAdmin.s.sol` and `VerifyOnchain.s.sol` (`npm run
      supervisor:besu`, `verify:besu`), tried on anvil. `governance-model.js`
      keeps only what `export-abi.js` reads. The console's wallet hint points
      at GUIDE.md for the supervisor's key.

## Done: the per-TI model

- [x] **A** Interfaces: `ICertificateGovernance` from its parts and
      `ICertificateRegistry`; `TiSetup`, `Cosigner`, `TiView`, `Certificate`;
      `tiId = keccak256(bytes(did))`.
- [x] **P1–P3** OpenZeppelin upgradeable; both contracts behind a
      `VersionedUpgradeableBeacon` and a proxy; storage in ERC-7201
      namespaces (`StorageNamespaces.t.sol`).
- [x] **G** EBSI's own contracts in `local/ebsi-mock/` (DID Registry, Trusted
      Issuers Registry and the rest), deployed by `DeployEBSI.s.sol` and
      seeded by `SeedEbsi.s.sol`; never in the prod build. This settles O4.
- [x] **B1–B3** `addTi`, TAO only, refused unless the TIR shows a live
      accreditation by `taoDid`. A revoked TI needs no call: `isActiveTi`
      asks the TIR, up to the RootTAO, whenever a TI starts or executes
      something.
- [x] **C1, C4** A TI's keys are signers under its DID, changed by its ADMIN
      quorum (`proposeAddSigner`, `proposeRemoveSigner`,
      `proposeReplaceSigner`); a removed key is retired for good. Cosigners
      are other DIDs with one role each, set by the TAO (`setCosigners`).
- [x] **D1, D4** Policies and the proposal TTL per TI, checked within the TI.
- [x] **E2, E4–E7** Proposals per TI, on `statusKey`. A revoked TI can
      neither propose nor execute; signatures on its open proposals change
      nothing. A key counts only while the DID Registry shows it (`roleOf`,
      at every signature and at `execute`). Kept: the timelock restart, the
      TTL, `reasonHash`, one open proposal per certificate. E1's commitment
      is gone: the record keeps the hash of the signed credential instead.
- [x] **F1, F4** Rule changes per TI under its ADMIN policy;
      `setRegistries` by the owner.
- [x] **H** `getTi`, `getPolicy`, `roleOf`, `isSigner`, `retired`,
      `getProposal` and `getAdminProposal` with `tiId`.
- [x] **I** Tests for all of the above, among them `EbsiTrustChain.t.sol`
      against EBSI's contracts.
- [x] **J** `Deploy.s.sol` (both contracts), `AddTi.s.sol`,
      `RotateSigners.s.sol` and `SupervisorAdmin.s.sol` per TI (`TI_DID`),
      `export-abi.js`, `VerifyOnchain.s.sol`.

## Open: to decide

- [ ] **O1** Who owns the beacons, and how long an upgrade waits (proposed:
      the RootTAO, 14 days). Settled together with X6.
- [ ] **O2** Who may change the DIDR and TIR addresses. Today the owner, at
      once (`setRegistries`); proposed: only by an upgrade.
- [ ] **O3** Who replaces NBÚ's DID as the scheme's owner. Needed only for E3
      and D2.
- [ ] **N1** A revoked TI's certificates are withdrawn with `suspendNow` and
      stay `SUSPENDED` on chain; decide whether they must end `REVOKED`, which
      needs a quorum the revoked TI no longer has.
- [ ] **N2** Whether a TI's rule changes need the TAO or the supervisory
      authority: a required role in the ADMIN policy of `pilot.json` and
      `production.json`. Today the rule (loosening needs the supervisory
      authority's signature first) holds only in the back-office.
- [ ] **N3** Whether the record keeps `validFrom` and `validUntil` (GDPR).
- [ ] Left over from the member model, not built. Each is either built or
      dropped:
  - [ ] **B4** `replaceAdmin(newTaoDid)`, by the RootTAO.
  - [ ] **C2–C3** A new key active after 24 h; a pending key can be cancelled.
  - [ ] **C5–C6** Recovering a role with no key left (the TAO and the other
        role, 72 h), or a TI with none (the TAO and the RootTAO, 7 days).
  - [ ] **D2–D3, F2** A floor of minimum rules set by the scheme's owner,
        with a 7-day wait the TAO can stop; a TI's policy is the stricter of
        its own and the floor.
  - [ ] **E3** The scheme's owner (NBÚ) proposes a suspension only: not
        counted in the quorum, no veto, may withdraw its own.

## Open: work

- [ ] **P4** `version()` and `reinitializer(n)`, with the first upgrade that
      migrates storage.
- [ ] **P5** The beacons' owner, per O1 and X6.
- [ ] **J8** `scripts/verify-contracts.sh` verifies `CertificateRegistry`
      and its beacon too, not only `CertificateGovernance`.

## Outside the contract, needed to use it

- [x] **X1** Back-office (TypeScript, `back-office/`): every governance call
      names its TI (`tiId`): `server/lifecycle/governance.ts`,
      `server/lifecycle/console-ledger.ts`, `server/keys/ledger-signing.ts`;
      `server/lifecycle/admin-policy.ts` reads the TI's policies.
- [x] **X2** No Gateway: the back-office sends through EBSI's Ledger API
      itself (`server/ebsi/ledger.ts`) and follows the events per TI.
- [x] **X3** Console: governance per TI (`back-office/web/src/features/governance`).
- [ ] **X4** Confirm with the client that a record need not be found by the
      certificate number (its key comes from the TI's DID and the credential's
      id, though the client once asked for lookup by number), and how a paper
      certificate is checked on chain (the id or a QR code on it). The random
      certificate number is no longer needed for the chain.
- [x] **X5** The back-office, the console and the Wallet read and write
      certificates on `CertificateRegistry` (`REGISTRY_ABI`, its own address)
      and follow `CertificateStandingChanged` there. The V4 `statusKey`
      (`back-office/server/issuance/protection.ts`, and the Wallet's
      `src/infrastructure/ledger`), computed after collection; a verifier
      computes the key from `vc.id` and `credentialStatus` no longer carries it;
      a status change only after collection; `/registry/issue` returns no key;
      the console finds a record by issuer and id. `credentialHash` of the
      signed JWT, registered with the record at collection and compared by the
      verifier and the Wallet; proposals on `statusKey`; the commitment and its
      salt are gone from the record and from audit disclosure. `APPROVED`
      replaces `QUORUM_REACHED` and `TIMELOCKED` (with a migration of
      `onchain_state`), in the back-office and the console, which shows a running
      timelock from `executableAt`.
- [ ] **X7** Rename `test/CommitmentInterop.t.sol` after the `Hashes` library
      (left from X5).
- [ ] **X6** A timelock in front of the TAO, owning both contracts and
      both beacons; `onlyTao` and `setRegistries` stop asking the DID Registry
      about the sender (a contract is no key of a DID).
