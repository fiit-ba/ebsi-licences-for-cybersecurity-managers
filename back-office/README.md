# Atest Back Office

Node 24 runs the TypeScript API/console and a separate BullMQ worker process.
PostgreSQL owns domain state, immutable audit, retained delivery intent and shared
rate admission. One Redis provides the DB-0 broker and DB-2 exchange cache.
KMS owns signing keys and wraps the data-encryption/PIN/commitment secrets.
The certificate registry owns each collected certificate's record and standing;
its governance contract owns each TI's signers, quorum, vetoes and timelocks.
Writes reach them, and EBSI's registries, through EBSI's Core API v1 Ledger API.

See [installation](../docs/GUIDE.md), [architecture](docs/architecture.md),
[configuration](docs/configuration.md), [background execution](docs/background.md) and [validation](docs/validation.md).
Unversioned protected data uses the explicit [key import](docs/field-encryption.md).
The API preserves existing Wallet and console request/response contracts and
roles. Account credentials follow the [password policy](docs/password-policy.md).
The frontend design, routes and translations remain in `web/`.

For ordinary local development, follow [the two-command startup](../docs/GUIDE.md):
start the ledger and deploy the contracts, set the shared host and contract addresses
in `infra/.env`, then run `docker compose up --build -d` and `./bootstrap.sh` from
`infra/`. Bootstrap prepares all demo accounts, the full certificate form, hierarchy,
KMS keys, publication in the development EBSI registries and each TI's setup on the
governance contract. No manual password-file or sequence
of individual key/registry commands is required. Public API/console port stays 8000.

`alice`, `bob`, `supervisor` and `mirri` initially use `PLR_DEV_PASSWORD` (default
`Atest-2026!Demo`). Existing passwords, schema edits, identities and
accreditation deadlines survive repeat bootstrap. The hosted installation uses
`bootstrap:admin` with a private password file and its own explicit credentials;
the development seed is disabled there.

For frontend development run `npm ci` and `npm run dev`. Vite stays on 5173 and
proxies to the local API at 8000; `BACK_OFFICE_DEV_API_URL` and `PLR_LEDGER_RPC_URL`
override API/ledger addresses. The API process itself uses
`127.0.0.1:8088` by default for host-native `npm start`; Compose maps external 8000
onto its internal 8088 listener. Built frontend and hosted edge use the same existing
`/api-backend` prefixes and direct API routes. Readiness proves DB/schema availability;
provider failures retain lazy retry. Protected operations need KMS on the first
key load; warm processes can continue with keys already held in memory.

Server modules/tests are grouped by domain; browser workflows live in
`web/src/features/`, shared public types in `shared/`, migrations in
`data/migrations/`. Scripts and checks are TypeScript. Follow [AGENTS.md](AGENTS.md).

```sh
npm run format:check
npm run check:docs
npm run typecheck
npm run build:web
# Only against a NEW disposable atest_back_office_test database; needs Foundry:
npm run migrate
npm test
```

`npm test` starts its own anvil ledger with the contracts and the development EBSI
service; see [validation](docs/validation.md).

Every full server sequence requires a new disposable database. Never clear or
rewrite the immutable audit journal between runs. Existing development databases
and other projects' containers/volumes are outside these checks.
