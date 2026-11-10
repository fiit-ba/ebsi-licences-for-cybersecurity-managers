# Runtime configuration

Ordinary development has complete demo seed/default configuration through `./bootstrap.sh`.
Its only required environment choices are the shared public host and the deployed
contracts. The public API/console default remains 8000; internal Node stays 8088.
The explicit development-only flag prevents demo initialization in hosted mode.

Ordinary development settings live in `infra/.env.example`; hosted settings in
`infra/prod/env.example`. Compose passes PostgreSQL `PG*` settings to migrations,
bootstrap and runtime consistently. Host-native operation can use a private
`back-office/.env` with `node --env-file=.env server/http/start.ts`; `npm start`
uses its inherited environment. Never supply a working database to acceptance checks.

| Setting                                                                      | Meaning                                                                                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`                     | PostgreSQL connection for all ordinary CLI/runtime entry points                                                                              |
| `HOST`, `PORT`                                                               | Default `127.0.0.1:8088`; Compose binds the container listener explicitly                                                                    |
| `BACK_OFFICE_TOKEN_SECRET`                                                   | Persistent private authentication/throttle secret, at least 32 characters                                                                    |
| `BACK_OFFICE_ISSUANCE_ENABLED=true`                                          | Ordinary full product composition; low-level domain tests can disable it explicitly                                                          |
| `PLR_FIELD_KMS_KEY_ID`                                                       | Symmetric KMS wrapping-key ARN; required for hosted bootstrap, automatically prepared locally                                                |
| `BACK_OFFICE_PUBLIC_ORIGIN`                                                  | Canonical shared HTTP(S) issuer origin, without a path/query                                                                                 |
| `PLR_ISSUER_DID`                                                             | Registry authorization-signing RootTAO DID (distinct from each TI DID)                                                                       |
| `PLR_EBSI_URL`                                                               | EBSI's Core API v1 origin: Authorisation API tokens for every Ledger API write                                                               |
| `PLR_DIDR_URL`, `PLR_TIR_URL`, `PLR_TSR_URL`, `PLR_TRUSTED_ROOT_DIDS`        | Core API v1 registry bases (`/v1/did-registry/identifiers`, `/v1/issuers-registry`, `/v1/schemas-registry`) and trusted Support Office DIDs  |
| `PLR_EBSI_MOCK_URL`                                                          | Development Support Office (RootTAO onboarding, schemas, key funding); enables automated publication; absent for real manual EBSI onboarding |
| `PLR_LEDGER_RPC_URL`, `PLR_LEDGER_CHAIN_ID`                                  | The Ledger API (`/v1/ledger`) and its pinned chain                                                                                           |
| `PLR_CERTIFICATE_REGISTRY`, `PLR_GOVERNANCE_CONTRACT`                        | The deployed certificate registry and its governance contract                                                                                |
| `PLR_GOVERNANCE_TAO_DID`, `PLR_SUPERVISOR_DID`                               | Development: the TAO the contracts were deployed for, and the supervisory authority set as each TI's role C cosigner                         |
| `PLR_TI_GOVERNANCE_CONFIG`                                                   | Development: a `contracts/config/*.json` file with the rules each new TI gets; default the pilot rules                                       |
| `PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL`                                         | Registered schema for the ledger status entry                                                                                                |
| `PLR_GOVERNANCE_CONSOLE_ROLES`                                               | Default A,B; signer keys remain purpose-bound and human grants explicit                                                                      |
| `REDIS_BROKER_URL`                                                           | BullMQ broker, DB 0; required for worker, supplied by Compose                                                                                |
| `PLR_WORKER_CONCURRENCY`                                                     | Total worker slots, default 2                                                                                                                |
| `PLR_GOVERNANCE_RECONCILE_SECONDS`, `PLR_STANDING_SWEEP_SECONDS`             | Reconciliation intervals, defaults 120/60 seconds                                                                                            |
| `PLR_REDIS_CACHE_URL`                                                        | Shared expiring exchange cache; configured failures never select another cache                                                               |
| `AWS_REGION`, optional AWS credentials                                       | KMS runtime credentials; prefer instance/task roles                                                                                          |
| `PLR_KMS_ENDPOINT_URL`                                                       | Development KMS endpoint; absent for AWS                                                                                                     |
| `PLR_NUM_PROXIES`                                                            | Default 0; hosted edge+mesh use 2 trusted hops; untrusted forwarded tails are refused                                                        |
| `PLR_WALLET_BACKUP_MAX_BYTES`, `PLR_WALLET_BACKUP_RATE`                      | Default 128 MiB text + 64 KiB request envelope, 30/min; nginx allows 129 MiB                                                                 |
| `PLR_ORGANIZATION_REGISTRATION_RATE`                                         | Default 10/hour; explicit test-only installations may raise it for repeated acceptance                                                       |
| `PLR_EXCHANGE_NETWORKS`                                                      | Allowed Wallet listener CIDRs; default private `192.168.0.0/16,10.0.0.0/8`                                                                   |
| `BACK_OFFICE_DEV_API_URL`                                                    | Vite server-side API proxy target; default local TypeScript API                                                                              |
| `VITE_GOVERNANCE_CONTRACT`, `VITE_LEDGER_CHAIN_ID`, `VITE_LEDGER_WALLET_RPC` | Public build-time console network settings                                                                                                   |

## Mail and timestamp delivery

Enable recovery/activation mail with `BACK_OFFICE_PASSWORD_RECOVERY_ENABLED=true`,
canonical base64 32-byte `BACK_OFFICE_PASSWORD_RECOVERY_KEY`, `POSTMARK_API_KEY`,
`DEFAULT_FROM_EMAIL` and the public origin. Recovery/activation hours default to
24/72 and accept whole hours 1–168 through `BACK_OFFICE_PASSWORD_RECOVERY_EXPIRY_HOURS`
and `BACK_OFFICE_ACTIVATION_EXPIRY_HOURS`. Administrative creation queues activation;
public organization registration does not. Failure retries the same durable challenge.

Enable timestamp delivery with `BACK_OFFICE_TIMESTAMP_ENABLED=true`,
`BACK_OFFICE_TIMESTAMP_KMS_KEY_ID`, `BACK_OFFICE_TIMESTAMP_RPC_URL`,
`BACK_OFFICE_TIMESTAMP_CHAIN_ID`, `BACK_OFFICE_TIMESTAMP_CONTRACT` and
`BACK_OFFICE_TIMESTAMP_ACCESS_TOKEN_FILE`. The last setting names an externally
rotated compact bearer JWT file, reread on every request. It is not an automatic
EBSI authorization implementation. Hosted Compose mounts `PLR_TIMESTAMP_TOKEN_DIR`
read-only at `/run/timestamp`, with its `access-token` file. Configure
`BACK_OFFICE_TIMESTAMP_MAX_GAS_PRICE_WEI` for the provider fee policy; optional
confirmations/gas limit default to 1/500000. Timestamp keys must be independent of
governance signers with a single active writer. Both optional delivery handlers run in the shared worker process. Enabled hosted
handlers require their configured provider.

Use `npm run keys` for the existing identity/list/plan/provision/attach/activate/
retire/confirm-issuer ceremonies (each TI's A and B governance keys are purposes of
its own keys) and `npm run relying-party` for external verifier keys. Command argument errors print
usage. `npm run bootstrap:registry:development` is restricted to an explicit mock;
uncertain CreateKey cannot be retried blindly. KMS key locators are not private keys.

Development KMS uses the pinned `gresau/localstack-persist:3.8.0` image with
`product-kms:/persisted-data`. Its persistence extension is a declared development
dependency; hosted AWS KMS is unchanged. The image persists KMS state using its
state hooks ([provider documentation](https://github.com/GREsau/localstack-persist#usage)).
The installation check compares actual GetPublicKey material before/after restart,
then performs real lifecycle signatures. Treat its private persisted volume as
development signing-key storage. Never expose the emulator as a hosted KMS.

Data encryption uses [KMS envelope protection](field-encryption.md). Installations containing unversioned ciphertext require the explicit
key-import procedure before provisioning protected operations.

Host-native execution uses `npm start` and `npm run worker` as separate processes.
`npm run health:worker` checks its named Redis consumer, six registered schedules
and PostgreSQL. Compose supplies both processes automatically. See
[background execution](background.md) for queues, persistence and recovery.
