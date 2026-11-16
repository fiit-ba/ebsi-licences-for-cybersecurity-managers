# Development EBSI service

This development-only service serves EBSI's Core API v1 over EBSI's own registry
contracts (`contracts/local/ebsi-mock`) on the development ledger: the DID, issuers,
schemas and timestamp registries (`/v1/did-registry`, `/v1/issuers-registry`,
`/v1/schemas-registry`, `/v1/timestamp`), the Authorisation API (`/v1/auth`) and the
Ledger API (`POST /v1/ledger`). Reads come from the contracts; every write is a
transaction the client signs itself and sends through the Ledger API with a token
whose scope covers it. The registries keep their state on the ledger, so a restart
loses nothing. It performs no production authorization and must not be exposed as
a hosted service.

Ordinary Compose builds it automatically. It reads the deployed contracts from the
records in `contracts/deployments` (`MOCK_EBSI_DEPLOYMENT`, `MOCK_GOVERNANCE_DEPLOYMENT`,
or each address directly: `MOCK_DID_REGISTRY`, `MOCK_ISSUERS_REGISTRY`,
`MOCK_SCHEMAS_REGISTRY`, `MOCK_TIMESTAMP`, `MOCK_POLICIES_REGISTRY`) and sends to
`MOCK_LEDGER_RPC_URL`. `MOCK_BASE_URL` must be the public origin reachable by API
containers and Wallet. `MOCK_SUPPORT_OFFICE_DID` must match `PLR_TRUSTED_ROOT_DIDS`;
ordinary Compose uses `did:ebsi:zSupport`. `MOCK_SUPERVISOR_DID` names the
supervisory authority whose DID the development key 5 (`contracts/scripts/Networks.sol`)
controls. The API uses `PLR_EBSI_URL`, `PLR_DIDR_URL`, `PLR_TIR_URL`, `PLR_TSR_URL`
and `PLR_LEDGER_RPC_URL` (`/v1/ledger`) as it would EBSI's, and `PLR_EBSI_MOCK_URL`
for what only EBSI's Support Office does: onboarding a RootTAO, registering schemas
and funding development keys (`/__mock/support-office/*`, `/__mock/fund`).

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
