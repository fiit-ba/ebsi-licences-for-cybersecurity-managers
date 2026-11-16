# Validation

Use Node 24 for Back Office and contracts. Install locked dependencies with
`npm ci` in each package. The Wallet uses its checked-in Node version and
`yarn install --frozen-lockfile`; see [Wallet build and release](../../docs/WALLET_BUILD.md).

## Back Office checks

From `back-office/`:

```sh
npm run format:check
npm run check:docs
npm run typecheck
npm run build:web
npm run check:standalone
```

`check:docs` checks TSDoc structure; documentation accuracy also requires review.
`check:standalone` checks current package entry points and disallows archive or
source-fetch dependencies in product code. It requires no Git history.

Each complete server suite requires a **new disposable PostgreSQL database**
named `atest_back_office_test`. Supply its `PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD` and `PGDATABASE`. Never reset a working database or erase immutable
audit to reuse a test database.

The checks run on a development ledger: anvil with EBSI's registries, the
certificate registry and its governance deployed by the contracts' own Foundry
scripts, and the development EBSI service (`infra/ebsi-mock`) serving EBSI's Core
API v1 over it. Install [Foundry](https://getfoundry.sh), run
`forge soldeer install && forge build` in `contracts/` and `npm ci` in
`infra/ebsi-mock/`. `npm test` starts one such ledger and service for its run.
For checks run on their own (browser suites, `checks/*-ledger.ts`), start them once
and keep them running:

```sh
# From back-office/, in a separate terminal; prints the two variables to export.
node scripts/test-ledger.ts > /tmp/test-ledger.env
```

and `source` that file wherever the checks run (`BACK_OFFICE_TEST_LEDGER`,
`BACK_OFFICE_TEST_EBSI_URL`). Your own `contracts/deployments/anvil*.json` records
are put back after each deployment. Use one isolated Redis instance:
`BACK_OFFICE_TEST_REDIS_URL` selects DB 2 and `BACK_OFFICE_TEST_BROKER_URL` selects
DB 0. Then:

```sh
# From back-office/, with the disposable test environment exported:
npm run migrate
npm run migrate
npm test
```

The suite discovers colocated `server/**/*.test.ts` checks. Domain fixtures use
real PostgreSQL, cryptography, signed development registries and owned local
contracts. External KMS/mail faults use explicit fixtures. Broker integration
checks require `BACK_OFFICE_TEST_BROKER_URL`; without it those checks are skipped.

Background checks cover commit/rollback ordering, broker refusal, current retry
budgets, urgent priority, sweep deduplication, repeated scheduler registration,
concurrent signatures and stalled redelivery. A child worker is killed after
actual contract execution and before acknowledgement; retries must not allocate
another signature/nonce or duplicate contract execution.

Password regressions cover Unicode length, bounded oversized input, predictable
patterns, phrases, account-context isolation and login refusal for matching hashes
whose passwords fail the policy. Account
administration, registration and recovery tests exercise the same server policy;
see [password policy](password-policy.md).

## Console browser checks

Install Chromium from `back-office/` with `npx playwright install chromium`.
The API-backed suites use PostgreSQL and explicit provider fixtures; their
Playwright configuration starts the required test services. Run with the same
isolated test settings:

```sh
npm run test:identity:web
npm run test:organizations:web
npm run test:issuance:web
npm run test:verification:web
VITE_LEDGER_CHAIN_ID=31337 npm run build:web
npm run test:lifecycle:web
npm run test:web
```

`test:web` exercises console interactions with HTTP fixtures and real voting on the
contracts, for a TI set up on the test ledger: its A and B keys, and the supervisory
authority's development key as an external wallet signing as role C. It is separate from acceptance against an ordinary installation.
No command starts the user's browser or native Wallet application.

## Contract checks

From `contracts/`:

```sh
forge test
node scripts/export-abi.js --check
```

From `back-office/`, on the test ledger:

```sh
node checks/governance-ledger.ts
node checks/timestamp-ledger.ts
```

These check exact registration and recovery after lost responses, chain/contract
bindings, confirmation depth, standing, governance, emergency protection and
withdrawal on the contracts as deployed, and commit-reveal timestamp evidence on
EBSI's Timestamp contract as `contracts/` deploys it; neither certifies a real EBSI
node. Verifier outcomes against registry records are covered by the server suite.

## Ordinary installation acceptance

From `back-office/`:

```sh
PLR_TEST_PUBLIC_HOST=<host-reachable-from-containers-and-test-clients> npm run test:installation
```

The runner creates unique Compose resources, ports, a fresh database and its own
anvil ledger with the contracts deployed as `npm test` deploys them; it needs
Foundry. It runs the normal images and `infra/bootstrap.sh`, repeats
bootstrap, and compares account/password hashes, organizations, schema versions
and actual KMS public material. It does not use the working Besu network.

The command first runs HTTP-probe regressions. Status probes consume the complete
response and close their connections so a service restart or a blocking setup
command cannot leave an idle socket for the next probe to reuse. Readiness probes
have a ten-second timeout. Protected-read probes allow 45 seconds for the existing
cold path: up to three ten-second KMS operations plus database and HTTP overhead.
The probe reports the failed path with the original error as its cause. A probe
never retries a request; readiness loops poll during startup, while outage checks
require the exact expected `200` or `503` status.

Actual Wallet clients exercise offer/discovery/token/collection, SD-JWT, callback
verification, encrypted backup restore and holder exchange. The runner checks
provider restart/outage, warm-key continuity, cold KMS refusal, authenticated
field-key import, separate human decisions, timelocked revocation and live role
removal. Native storage bindings are substituted in these headless client checks.
The cold API outage pauses the owned KMS container, forcing requests to wait for
the actual SDK deadline. Cleanup unpauses it before stopping owned resources.

The background acceptance check stops Redis, commits HTTP decisions, stops the API
while the worker remains running, then verifies automatic schedule/database recovery
and actual contract standing after Redis returns. Worker restart and repeated
submission must preserve signature counts. The runner uses two-second governance
and standing intervals only in its own environment; default intervals are checked
separately. Built-console and Vite-proxy checks exercise actual API routes.

Cleanup stops only owned resources and retains volumes. KMS is LocalStack and the
registries are signed development fixtures. Real AWS IAM, EBSI onboarding,
Postmark, hosted TLS, signed mobile binaries and device storage require validation
in their deployment environments.

## Wallet checks

From `holder-wallet/`:

```sh
yarn verify
yarn check:dependencies
yarn build:ios
yarn build:android
```

The build commands above export JavaScript/assets; they do not produce installable
mobile binaries. Native builds, signing and device acceptance are described in
[Wallet build and release](../../docs/WALLET_BUILD.md).
