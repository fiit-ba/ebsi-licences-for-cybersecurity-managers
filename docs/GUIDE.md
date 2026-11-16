# Run the Professional License Registry locally

The main path below starts the TypeScript backend, built operator console,
a separate BullMQ worker, PostgreSQL, one Redis (broker DB 0/cache DB 2), local KMS and the development EBSI service. Besu runs in a separate
Compose project. Run the numbered steps in order; commands in each step continue
from the directory left by the preceding step. No browser or mobile app opens
automatically.

## 1. Prerequisites and Besu

Install Node **24**, npm, Docker with Compose and [Foundry](https://getfoundry.sh),
and start Docker Desktop (on macOS). Node also runs the host-side bootstrap; contract dependencies are installed
below. The regular container setup does not require installing `back-office/`
dependencies on the host.

Start from the repository root:

```sh
cd /path/to/professional-licenses
node --version
docker compose version
cd infra/besu/besu-qbft-network
docker compose up -d
```

Container startup does not mean consensus/RPC is ready yet. Check:

```sh
curl --fail --silent --show-error http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl --fail --silent --show-error http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

Wait for chain ID `0x539` (1337) and a block number greater than `0x0`.
Repeat the checks until ready. Inspect `docker compose logs --tail=100` in this
directory if the network does not become ready.

## 2. Deploy the contracts — first install or intentional chain reset

The contracts are built and deployed with [Foundry](https://getfoundry.sh)
(`forge`, `cast`, `anvil`); install it first.

```sh
cd ../../../contracts
forge soldeer install
forge build && node scripts/export-abi.js
forge script scripts/DeployEBSI.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
GOVERNANCE_TAO_DID=did:ebsi:zmQaJTYt1ftvnjrwxWpPDUX \
  forge script scripts/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

The first deployment puts EBSI's registries (DID, issuers, schemas, timestamp,
policies) on the chain and records them in the ignored
`contracts/deployments/besu-ebsi.json`; the development EBSI service serves its
Core API v1 over them. The second deploys the certificate registry and its
governance for the development TAO and records both addresses in
`contracts/deployments/besu.json`. Keep the `CertificateRegistry` and
`CertificateGovernance` addresses for the next step. Deployment uses the local
pre-funded development keys (`contracts/scripts/Networks.sol`); it does not
provision production signers. On an ordinary restart with preserved Besu data,
skip deployment and keep the existing addresses. `mvp-scripts/start-mvp.sh` runs
these steps itself whenever the contract sources change.

If Besu data was cleared, this deployment step is required even when `infra/.env`
already contains old addresses. An address alone does not prove the contract
exists on the newly initialized chain. The network's genesis now enables the
Prague fork the contracts are compiled for: a Besu data directory created from the
earlier genesis must be cleared once, and the contracts deployed again.

## 3. Configure the local installation

```sh
cd ../infra
# Create the file only if absent; keep existing passwords, key locators and settings.
[ -f .env ] || cp .env.example .env
```

Edit `infra/.env` before continuing:

```dotenv
PLR_GOVERNANCE_CONTRACT=0xCertificateGovernanceAddress
PLR_CERTIFICATE_REGISTRY=0xCertificateRegistryAddress
PLR_PUBLIC_HOST=your-device-reachable-host
```

`PLR_PUBLIC_HOST` contains a hostname or LAN IP, without scheme, path or port. It
must resolve/reach the host from Docker containers, the browser and the Wallet.
Use a stable LAN address or shared DNS name. With a LAN address, also set:

```dotenv
PLR_BIND_ADDRESS=0.0.0.0
```

Alternatively bind the specific host LAN address. The default `127.0.0.1` exposes
ports only through host loopback; do not combine it with a LAN-only public origin
and expect containers/phones to reach that origin. `localhost` and Android's
`10.0.2.2` are not shared issuer names. The firewall must allow the intended clients
to reach API port 8000 and registry port 8090. Node RPC port 8545 is needed by
ledger clients. Keep the development stack on a trusted development network.

Other development settings have usable defaults. No manual encryption-key
creation, password-file transfer, account administration or separate key ceremony
is required. Hosted setup uses the separate procedure in [PRODUCTION.md](PRODUCTION.md).

## 4. Start the product and bootstrap

Still in `infra/`:

```sh
docker compose config -q
docker compose up --build -d
./bootstrap.sh
```

Wait for bootstrap to print `Ready: http://<PLR_PUBLIC_HOST>:8000`. It checks the
keys/ledger as well as seeding data; do not treat a running container alone as a
complete installation. The backend serves the built console and public API at
that origin; the development EBSI service uses port 8090. Internal Node stays on 8088. No separate
frontend process is needed for this mode.

`PLR_API_PORT` and `PLR_REGISTRY_PORT` override the public ports. If changed, use
those ports consistently in client URLs. `GET /health/ready` checks database/schema
readiness; bootstrap performs the additional KMS/contract checks.

For an existing TypeScript database that still used a raw
`BACK_OFFICE_ISSUANCE_KEY`, first follow the explicit
[field-key import](../back-office/docs/field-encryption.md). Bootstrap refuses
to generate replacement material for that database.

## What bootstrap prepares

The same `./bootstrap.sh` waits for migrations and healthy dependencies, then:

- Creates `supervisor`, `mirri`, `alice` and `bob` with the configured initial
  `PLR_DEV_PASSWORD` (default **`Atest-2026!Demo`**).
- Creates NBÚ (RootTAO/supervisor) → MIRRI (TAO/mirri) → STU FIIT (TI/alice), with
  one-year TI accreditation and delegated certificate schema.
- Publishes `CybersecurityManagerCertificate` with all 15 form fields,
  labels and defaults, plus the presentation/verification flow.
- Prepares KMS-wrapped data-encryption and stable PIN/commitment secrets without
  placing plaintext data keys in `.env`.
- Creates/resumes purpose-separated registry, TAO and TI signing keys inside KMS
  (each TI's own A and B governance keys among them), and publishes the DIDs, keys
  and accreditations in the development registries through EBSI's Core API v1.
- Hands the certificate registry and its governance to the TAO's KMS key, which sets
  each TI up on them with its A and B keys and the supervisory authority's DID as
  cosigner C, whose keys stay outside the installation.
- Checks actual KMS key availability, exact ledger chain/roles and an unknown
  certificate's standing before reporting success.

| Account      | Ready-to-use role                                       |
| ------------ | ------------------------------------------------------- |
| `alice`      | TI issuer, status manager, verifier and governance A    |
| `bob`        | Independent status manager, verifier and governance B   |
| `supervisor` | RootTAO, auditor and initial full account administrator |
| `mirri`      | TAO selecting and managing its TIs                      |

The default development password satisfies the [account password policy](../back-office/docs/password-policy.md);
weak-password checks are not bypassed. Only `supervisor` needs full staff/
platform administration. Business authority, A/B memberships and human four-eyes
checks remain distinct; C has no private key on the server.

## Repeat, restart and partial failure

Run `./bootstrap.sh` again after a recoverable setup failure, or after a chain
reset and redeployment: the development registries keep their state on the ledger,
and bootstrap publishes the installation's identities on a new chain again. It reuses existing accounts, organizations, schema
versions and KMS requests; it never resets passwords, extends the TI's accreditation
or overwrites operator-edited schemas. It explicitly restores its named demo role
groups while retaining other memberships. It refuses to reactivate disabled accounts,
revive revoked organizations or adopt a different installation's initial administrator.
Migrations are idempotent and run before API readiness. Existing development databases
and unrelated Docker resources are never reset.

For a normal restart, start Besu and the product with their existing configuration:

```sh
# From the repository root:
docker compose -f infra/besu/besu-qbft-network/docker-compose.yml up -d
cd infra
docker compose up -d
./bootstrap.sh
```

After Docker itself restarts, the product's containers come back on their own, but
the Besu validators can stay exited: start them again with the first command above
and check that the block number advances. Docker stops responding when the host
disk fills up, so keep several gigabytes free; image rebuilds keep old layers in
the build cache until `docker builder prune` removes them.

Keep the contract addresses and all persistent data. `docker compose stop` in each
Compose directory stops its services without deleting state. Do not use
`docker compose down -v` as an ordinary stop: it removes PostgreSQL/KMS volumes.
A deliberate Besu reset requires contract redeployment and updated backend/Wallet
addresses; it also discards the chain history referred to by existing DB records.
Do not pair a reset chain with existing production records.

KMS storage persists across provider restarts. If a CreateKey response is lost before
its locator is recorded, the durable request remains uncertain. Recover that exact
tagged signing key with the existing `keys provision --recover-key` ceremony.
For the field-encryption wrapping key, recover its original ARN as described in
[field encryption](../back-office/docs/field-encryption.md); these are distinct
ceremonies. Bootstrap will not create replacement material blindly. Likewise, a
contract signer change waiting for its real policy timelock is reported as pending, rather than declared ready or
bypassed. Re-running bootstrap after execution observes the actual role membership.

`PLR_DEV_PASSWORD` applies only to newly created accounts. Changing it and rerunning
bootstrap does not reset existing passwords. Use account management for that.
The entry point resolves its own files independently of the working directory.
For example, from the repository root it accepts ordinary Compose selection:

```sh
./infra/bootstrap.sh --env-file /private/dev.env --project-name my-local-plr
```

Environment variables such as `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME` remain available.
The shell entry point delegates to the current TypeScript bootstrap.

## Frontend and Wallet

The built frontend is immediately available from the backend. For frontend development:

```sh
# From the repository root, in a separate terminal:
cd back-office
npm ci
npm run dev
```

Vite stays on `http://127.0.0.1:5173`, proxying API requests to
`http://127.0.0.1:8000` and ledger reads to `http://127.0.0.1:8545`. Override
`BACK_OFFICE_DEV_API_URL` and `PLR_LEDGER_RPC_URL` when using different addresses.
Existing routes, design, errors and authorization are preserved.

Copy `holder-wallet/.env.example` to `.env` and configure the same public
host/deployment:

```dotenv
BACKOFFICE_URL=http://<PLR_PUBLIC_HOST>:8000
EBSI_URL=http://<PLR_PUBLIC_HOST>:8090
CERTIFICATE_REGISTRY=0xCertificateRegistryAddress
LEDGER_CHAIN_ID=1337
EBSI_SUPPORT_OFFICE_DID=did:ebsi:zSupport
```

Wallet settings are compiled into its JS bundle. Offers, metadata, proof audiences,
presentation callbacks and backup use the same shared issuer origin. Android's
`10.0.2.2` is emulator-only, so it cannot be that shared origin. A physical device
must reach the API and registry ports. See [Wallet build and release](WALLET_BUILD.md).

Hosted AWS/EBSI/mail/timestamp/TLS configuration and the separate first-admin ceremony
are documented in [hosted setup](PRODUCTION.md) and
[runtime configuration](../back-office/docs/configuration.md). Local bootstrap is
explicitly disabled in the hosted template; its demo accounts/default secrets do
not enter hosted installations. No external deployment is performed by these steps.
