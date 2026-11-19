# Development EBSI service

This development-only service serves EBSI's APIs over EBSI's own registry contracts
(`contracts/local/ebsi-mock`) on the development ledger, in both shapes the back-office
speaks (`PLR_EBSI_API`):

- as EBSI's pilot network serves them: the Authorisation API v4 (`/authorisation/v4`,
  a presentation per scope's presentation definition; scopes `didr_*`, `tir_*`,
  `ledger_invoke`, `timestamp_write`), the DID Registry v5 (`/did-registry/v5`), the
  Trusted Issuers Registry v5 (`/trusted-issuers-registry/v5`), the Trusted Schemas
  Registry v3 (`/trusted-schemas-registry/v3`) and the Ledger API v4
  (`POST /ledger/v4/blockchains/besu`). A registry write is a transaction the client
  signs itself and submits to that registry's JSON-RPC `sendSignedTransaction`; the
  Ledger API forwards the pilot's read methods and takes Trusted Contract calls: the
  contracts named in `MOCK_INVOKE_CONTRACTS` (by default the first TAO's pair), EBSI's
  Proxy Factory, and every contract the factory deployed and keeps active (each
  further TAO's pair), as on EBSI;
- as Core API v1: `/v1/auth` (DCQL), `/v1/did-registry`, `/v1/issuers-registry`,
  `/v1/schemas-registry`, `/v1/timestamp`, and every write through `POST /v1/ledger`.

Reads come from the contracts, and a write needs a token whose scope covers it. The registries keep their state on the ledger, so a restart
loses nothing. It performs no production authorization and must not be exposed as
a hosted service.

Ordinary Compose builds it automatically. It reads the deployed contracts from the
records in `contracts/deployments` (`MOCK_EBSI_DEPLOYMENT`, `MOCK_GOVERNANCE_DEPLOYMENT`,
or each address directly: `MOCK_DID_REGISTRY`, `MOCK_ISSUERS_REGISTRY`,
`MOCK_SCHEMAS_REGISTRY`, `MOCK_TIMESTAMP`, `MOCK_POLICIES_REGISTRY`, `MOCK_PROXY_FACTORY`) and sends to
`MOCK_LEDGER_RPC_URL`. `MOCK_BASE_URL` must be the public origin reachable by API
containers and Wallet. `MOCK_SUPPORT_OFFICE_DID` must match `PLR_TRUSTED_ROOT_DIDS`;
ordinary Compose uses `did:ebsi:zSupport`. `MOCK_SUPERVISOR_DID` names the
supervisory authority whose DID the development key 5 (`contracts/scripts/Networks.sol`)
controls. The API uses `PLR_EBSI_URL`, `PLR_EBSI_API`, `PLR_DIDR_URL`, `PLR_TIR_URL`,
`PLR_TSR_URL` and `PLR_LEDGER_RPC_URL` as it would EBSI's, and `PLR_EBSI_MOCK_URL`
for what only EBSI's Support Office does: onboarding a RootTAO, registering schemas,
granting the RootTAO's ledger key `ProxyFactory:deployProxy` (`/__mock/support-office/deployer`)
and funding development keys (`/__mock/support-office/*`, `/__mock/fund`). At startup it points
EBSI's Proxy Factory at the Policies Registry and the DID Registry, as EBSI's is, so a deployer
needs the policy and must control the DID it deploys as.

```sh
npm ci
npm start
npm run smoke
```

After a chain reset, `sync:registry:development` in the backend publishes the
installation's schemas, authorities and TIs again, keeping PostgreSQL and KMS
identities. `POST /__mock/seed`, `/__mock/did-keys` and `/__mock/revoke` are test
fixtures that write a fabricated trust chain on the ledger; they are not product
APIs. Keys retain their individual DID purposes and activation windows. The
fixtures date those windows from the earlier of the block time and the wall clock,
so a ledger clock running ahead of or behind the host cannot make a fresh
fixture not yet valid.

See [installation](../../docs/GUIDE.md) and [EBSI profiles](../../back-office/docs/ebsi-profiles.md).
The service is a provider substitute; passing it does not certify real EBSI writes,
AWS KMS, hosted TLS, mail or native/device acceptance.
