# Atest Professional License Registry

Atest is a professional-licence platform with three connected parts:

- the **Back Office** issues credentials (OpenID4VCI 1.0), verifies presentations
  (OpenID4VP 1.0 with DCQL), and suspends and revokes credentials;
- the **Atest Wallet** stores holder keys and credentials on iOS or Android;
- the **ledger** keeps each collected credential's record on the certificate
  registry, and each issuer's suspension and revocation decisions on its
  governance contract, signed by the issuer's own keys and the supervisory
  authority.

The repository also contains EBSI's registry contracts with a development service
that serves EBSI's Core API v1 over them, the certificate registry and its
governance, and the infrastructure needed to run the complete development
environment.

## What it does

- **Issuance:** a TI's operator issues a licence in the console. The holder collects
  it with OpenID4VCI 1.0 (pre-authorized code and a separately delivered 6-digit
  PIN as `tx_code`; five wrong PINs lock the offer, and the TI can re-offer). The
  licence is a W3C Verifiable Credential (data model 1.1, JWT, EBSI
  VerifiableAttestation) bound to a key the wallet derives for that issuer, with
  every attribute selectively disclosable.
- **The record on chain:** once collected, the licence's record (standing, validity,
  hash of the signed credential) is registered on the certificate registry. It is
  the only status there is; suspension, revocation and reinstatement go through
  the issuing TI's governance contract (two of its signers, a 24-hour timelock with
  veto for revocation, and the supervisory authority as cosigner).
- **Presentation:** a verifier asks with OpenID4VP 1.0 and a DCQL query; the holder
  chooses what to share among the combinations the verifier accepts, or declines,
  which the verifier learns at once.
- **Without the back office:** a holder presents phone to phone over Wi-Fi, and the
  verifying phone checks the licence against EBSI's registries and the ledger alone.
  Holding and presenting licences need no server; issuing does, since the back
  office is the issuer.
- **The wallet's protection:** a PIN unlocks it, and going to the background locks
  it on every screen. Its identity comes from a recovery phrase and its encrypted
  backup can be restored on another phone.

## Quick start

Install Node.js 24, Docker with Compose, Yarn 1.22, `jq` and
[Foundry](https://getfoundry.sh), then start from the repository root:

```sh
./start-mvp.sh
```

The launcher detects a device-reachable LAN address, prepares configuration and
dependencies, starts Besu and the service containers, deploys EBSI's registries
and the certificate registry with its governance whenever their sources change,
bootstraps demonstration data, and starts the web console and Metro. It prints the
current URLs and the commands for a connected phone.

The default development password for newly created demonstration accounts is
`Atest-2026!Demo`. It can be changed with `PLR_DEV_PASSWORD` before the first
bootstrap. Never use demonstration credentials in a hosted installation.

Stop the environment without deleting PostgreSQL, KMS or Besu data:

```sh
./stop-mvp.sh
```

For manual configuration, recovery procedures and a description of the seeded
roles, follow the [local installation guide](docs/GUIDE.md).

## Services

The launcher prints the effective host. With the default ports, it exposes:

| Service                  | Address               |
| ------------------------ | --------------------- |
| Operator website and API | `http://<host>:8000/` |
| Vite development website | `http://<host>:5173/` |
| Development EBSI service | `http://<host>:8090/` |
| Besu JSON-RPC            | `http://<host>:8545/` |
| Metro                    | `http://<host>:8081/` |

The launcher starts Vite by default. For frontend-only development, run
`npm run dev` in `back-office/`; it uses `http://127.0.0.1:5173` and proxies the
local API and ledger.

## Mobile Wallet

The normal launcher starts Metro. Install the app from another terminal:

```sh
cd holder-wallet
yarn ios --device --no-bundler
# or
yarn android --no-bundler
```

For Xcode, open `holder-wallet/ios/atestwallet.xcworkspace`. A physical phone
must be able to reach the host ports listed above. See [Wallet build and release](docs/WALLET_BUILD.md)
for prerequisites, environment variables, signing and release builds, and
[Atest Wallet](docs/WALLET.md) for holder workflows and architecture.

## Repository layout

- `back-office/` — TypeScript API, background worker and React operator console
- `contracts/` — certificate registry, its governance and EBSI's registry contracts
  (Foundry), deployment scripts and tests
- `holder-wallet/` — Expo bare / React Native application and native projects
- `infra/` — Docker Compose, Besu, local KMS and the development EBSI service
- `mvp-scripts/` — implementation behind `start-mvp.sh` and `stop-mvp.sh`
- `docs/` — central user, development and deployment documentation

## Documentation

Start with the [documentation index](docs/README.md). The main references are:

- [Local installation and bootstrap](docs/GUIDE.md)
- [Atest Wallet usage and architecture](docs/WALLET.md)
- [Wallet build and release](docs/WALLET_BUILD.md)
- [Hosted installation](docs/PRODUCTION.md)
- [Architecture and security boundaries](back-office/docs/architecture.md)
- [Runtime configuration](back-office/docs/configuration.md)
- [Validation commands](back-office/docs/validation.md)
- [Contracts: certificate registry and governance](contracts/README.md)
- [Contributing, support and security reporting](docs/CONTRIBUTING.md)

## Licence

The Wallet package is licensed under the [MIT License](holder-wallet/LICENSE.md).
Third-party dependencies remain subject to their own terms; see the Wallet's
[third-party notice entry point](holder-wallet/THIRD_PARTY_NOTICES.md).
