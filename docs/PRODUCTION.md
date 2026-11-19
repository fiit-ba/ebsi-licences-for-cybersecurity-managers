# Hosted installation

`infra/docker-compose.prod.yml` builds the TypeScript backend and operator console.
This is a deployment template, not evidence of an already running hosted service.
Execute these commands only on the selected deployment host. They do not deploy
contracts to EBSI or perform EBSI onboarding automatically. Demo seeds and the
local `infra/bootstrap.sh` are not used here.

## 1. Prepare configuration and providers

Start from the repository root on the deployment host:

```sh
cd infra
[ -f prod/.env ] || cp prod/env.example prod/.env
```

Fill every required setting in `prod/.env` before running Compose. Prepare:

- Public issuer and staff-console DNS names, a staff CIDR and public TLS certificate.
- The internal CA and `backend.crt/.key`, `edge.crt/.key`, `public.crt/.key` under
  `PLR_TLS_DIR`. The backend certificate identity is `plr-backend`; the edge client
  identity is `plr-edge`. `prod/make-staging-pki.sh` is for local staging only.
- Independent PostgreSQL, Redis and authentication secrets; an enabled symmetric
  `SYMMETRIC_DEFAULT` / `ENCRYPT_DECRYPT` KMS wrapping key in `PLR_FIELD_KMS_KEY_ID`.
  A plaintext data-encryption key is not configured.
- Authorized AWS credentials/workload identity, real EBSI registry roots and issuer
  DID, EBSI's API origin (`PLR_EBSI_API_ORIGIN`, `https://api-pilot.ebsi.eu` on the
  pilot, whose API shape `docker-compose.prod.yml` selects with `PLR_EBSI_API=pilot`),
  the addresses of the first TAO's certificate registry and governance contract as
  deployed with `contracts/`, EBSI's Proxy Factory (`PLR_PROXY_FACTORY`) through which
  the back-office deploys every further TAO's pair (EBSI's Support Office grants the
  RootTAO's ledger key `ProxyFactory:deployProxy` and a `VerifiableAuthorisationToInvoke`
  for it), their chain ID (6179 on the pilot), and reachable RPC
  URLs. The backend's `PLR_LEDGER_RPC_URL` is EBSI's Ledger API
  (`/ledger/v4/blockchains/besu` on the pilot), which needs a token from the
  Authorisation API for every transaction to the contracts; registry writes go
  through each registry's own JSON-RPC; `PLR_LEDGER_WALLET_RPC` must be
  client-reachable.
- An owner-only initial administrator password file on the host. The command below
  mounts it only for the one-time ceremony; it is not a regular backend mount.

Prefer workload identity for AWS. Provisioning needs different KMS permissions
from normal decrypt/sign operations; use the appropriate identity for each ceremony.
See [field encryption](../back-office/docs/field-encryption.md) and
[runtime configuration](../back-office/docs/configuration.md) for the actual settings.

## 2. Build, start storage and apply migrations

Still in `infra/`:

```sh
docker compose --env-file prod/.env -f docker-compose.prod.yml config -q
docker compose --env-file prod/.env -f docker-compose.prod.yml build
docker compose --env-file prod/.env -f docker-compose.prod.yml up -d --wait postgres redis
docker compose --env-file prod/.env -f docker-compose.prod.yml run --rm --no-deps migrate
```

Use a fresh PostgreSQL database for a new installation. Do not attach or reset a
working development database to rehearse deployment. Subsequent starts also run
the migration service before backend startup; ordered migrations are idempotent.

## 3. Initialize field protection and the first administrator

For a fresh database, wrap the generated data keys with the configured KMS key:

```sh
docker compose --env-file prod/.env -f docker-compose.prod.yml run --rm --no-deps backend \
  node scripts/field-keys.ts bootstrap
```

Existing TypeScript databases that used `BACK_OFFICE_ISSUANCE_KEY` require the
explicit [field-key import](../back-office/docs/field-encryption.md), with writers
stopped, instead of fresh key provisioning. Preserve their exact former secret.

Prepare the password with your secret-management workflow in a regular `0600`
file; do not put its value in shell arguments. Replace the host path below with
that file's absolute path. The one-off container uses its owner's numeric UID/GID
so it can read the private mount:

```sh
docker compose --env-file prod/.env -f docker-compose.prod.yml run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -v /private/initial-admin-password:/run/secrets/admin-password:ro backend \
  node scripts/bootstrap-admin.ts --username root.admin --root-name "Root authority" \
  --password-file /run/secrets/admin-password
```

Retain the returned `account_id` and `organization_id` for identity/key ceremonies.
This is an initial empty-database operation, not a password reset on subsequent starts.

## 4. Complete signing, registry and governance ceremonies

Run the existing purpose-bound CLI in the same configured container. Its commands
are `identity`, `list`, `plan`, `provision`, `attach`, `activate`, `retire` and
`confirm-issuer`; required actor/organization/key arguments depend on the operation.
For example, after the registry identity is prepared, inspect its stored keys:

```sh
docker compose --env-file prod/.env -f docker-compose.prod.yml run --rm --no-deps backend \
  node scripts/signing-keys.ts list --actor ACCOUNT_ID --organization ORGANIZATION_ID
```

Replace the uppercase arguments with actual IDs. Bind the correct issuer DID,
provision separate credential-signing, DID-authentication and ledger-transaction
purposes, publish their public DID relationships through the real EBSI process,
and confirm them before activation. Real DID/TIR onboarding remains manual;
this template cannot supply the deployment authority's credentials or approvals.

A TAO or TI is appointed by its own DID and lists the back-office's keys in its DID
document with its own wallet; it also stores the accreditation its accreditor issued
(downloaded under **Akreditácia v EBSI**) in the Trusted Issuers Registry itself.
Each TI signs on the governance contract with its own A and B keys, purposes
`governance_role_a` and `governance_role_b` of the same ceremony, which it lists as
capabilityInvocation keys of its DID; the TAO then sets the TI up on the
certificate registry's governance with them and the supervisory authority's DID as
cosigner C, through the contract's own administration. Grant separate humans the
A/B memberships. The development keys of `contracts/scripts/Networks.sol` are
public test accounts and are not a hosted ceremony.
No supervisory C private key enters the runtime. The certificate schemas come from
EBSI's Trusted Schemas Registry, where the Support Office registers them: name their
ids in `PLR_TSR_SCHEMAS`, and accredit the TIs for them before issuing.

## 5. Start the complete stack and check it

```sh
docker compose --env-file prod/.env -f docker-compose.prod.yml up -d --wait
docker compose --env-file prod/.env -f docker-compose.prod.yml ps
docker compose --env-file prod/.env -f docker-compose.prod.yml logs --tail=100 backend worker backend-mesh edge
```

The edge serves the staff console and forwards API calls over mTLS to the backend
sidecar on 8443, then Node on loopback 8088. The public issuer hostname serves
metadata, offers, collection, callbacks, verification and backup. `/admin/` is
staff-CIDR restricted; `/api-ledger` is unavailable on the public hostname. Trusted
proxy hops remain 2. Backups pass through both nginx layers with a 129 MiB limit.

Check HTTPS readiness at `https://<PLR_PUBLIC_HOSTNAME>/health/ready`, login from
the staff network and exercise the configured KMS/registry/ledger operations.
Readiness proves database/schema availability, not successful AWS/EBSI onboarding.
For subsequent starts retain configuration, keys, data and contract addresses;
repeat migrations/startup, not the initial administrator or key replacement.
`docker compose ... stop` preserves volumes; `down -v` deletes PostgreSQL and Redis volumes.

Timestamp anchoring still sends its transactions the Core API v1 way (through the
Ledger API); on the pilot, EBSI's Timestamp API takes them through its own JSON-RPC,
so keep `BACK_OFFICE_TIMESTAMP_ENABLED=false` there.

Enable mail or timestamp delivery only with their complete provider settings. See
[runtime configuration](../back-office/docs/configuration.md) for token-file mounts,
rotation, provider fee/ABI profiles and limits. Real AWS IAM, Postmark delivery,
EBSI onboarding, ledger/timestamp behavior and end-to-end hosted TLS must be checked
in the selected environment. Local acceptance does not certify those providers.

The `worker` service uses the same image with `server/worker/start.ts`, independent
of API restarts. Include it in normal Compose startup. A single password-protected
`redis:7` provides broker DB 0 and cache DB 2. Hosted `--appendonly yes` writes to
the existing `redisdata:/data` volume and applies to **both** logical databases;
expiring cache contents can appear on disk. Do not delete or reset existing volumes.
Queue keys use the `atest-bullmq` prefix; committed domain state is recovered by
periodic reconciliation. See
[background execution](../back-office/docs/background.md).
