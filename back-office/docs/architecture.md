# Architecture

`server/http/start.ts` serves public protocols, operator APIs and built console
assets. `server/worker/start.ts` consumes BullMQ jobs in a separate process.
Compose builds both services from `back-office/Dockerfile`; ordered SQL migrations
run under a PostgreSQL advisory lock before service startup. Vite and hosted nginx
use the same API paths.

| Owner                                | Responsibility                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `server/identity`                    | Scrypt accounts, live roles/session versions, staff/groups, activation/recovery and first-administrator bootstrap.      |
| `server/accreditation`               | RootTAO → TAO → TI hierarchy, invitations, delegation, accreditation, key onboarding and withdrawal.                    |
| `server/ebsi`                        | EBSI Core API v1 clients: Authorisation tokens, the Ledger API, DID/TIR publication and the development Support Office. |
| `server/schemas`                     | Draft/versioned publication, retirement and public Wallet catalogs.                                                     |
| `server/issuance`                    | OpenID4VCI 1.0 offers and transaction codes, nonces, holder proof, schema validation, SD-JWT and certificate records.   |
| `server/verification`                | Issuer signatures at issuance, trust/schema/record checks, OpenID4VP 1.0 (DCQL) requests and holder exchange.           |
| `server/lifecycle`                   | Registry decisions, independent approval, emergency protection, per-TI governance setup and reconciliation.             |
| `server/keys`                        | Purpose-bound KMS operations, durable key requests and exact transaction intents.                                       |
| `server/audit`                       | Immutable journal, private decisions/reasons, authorized disclosures and timestamp delivery.                            |
| `server/backup`                      | Opaque encrypted Wallet backup, signed updates/deletes and shared admission limits.                                     |
| `server/background`, `server/worker` | Broker submission, scheduling, dispatch, consumer lifecycle and health.                                                 |
| `web`, `shared`                      | Operator console and public TypeScript contracts.                                                                       |

Account creation, password changes and login use the same [password policy](password-policy.md).
Login requires both a matching scrypt hash and a password accepted for the current account details.

## State and providers

PostgreSQL owns domain state, encrypted private data, immutable audit and retained
delivery intent. One Redis supplies broker DB 0 and exchange-cache DB 2. A
configured cache failure does not switch to process memory. Redis persistence
applies to both logical databases; see [background execution](background.md).

KMS owns signing keys and wraps independent data-encryption and PIN/commitment
secrets. PostgreSQL stores authenticated wrapped keys; plaintext is cached only
in process memory. See [field encryption](field-encryption.md).

The certificate registry holds one record per collected certificate, under a key
derived from the issuing TI's DID and the credential's id: its standing, validity
and the hash of the signed credential. Its governance contract holds each TI's own
signers and roles, quorum, vetoes, expiry and timelocks; a TAO's key owns both
contracts and sets its TIs up on them. Local decisions, signed bytes and accepted
broadcasts do not establish blockchain confirmation.

## Product and security boundaries

- A fresh installation bootstraps its first administrator locally. Business roles
  and A/B governance memberships are separate. Each TI signs with its own A and B
  keys, published as keys of its DID; supervisory signer C is any key of the
  supervisory authority's DID and stays outside the installation.
- Live role removal, account deactivation and ancestor revocation invalidate access.
  Human four-eyes approval is independent of contract role quorum.
- Ordinary lifecycle authority is registry-wide, not per TI. Every issuer, status
  manager and auditor reads every TI's certificates, and any two different status
  managers can propose and approve a suspension, revocation or reinstatement of any
  certificate; the back office then executes it with that certificate's TI keys.
  A self-registered TI receives the status manager role, so the installation trusts
  each TI's staff with all TIs' certificates. Only emergency suspension is limited
  to the own TI (or, for a TAO or the RTAO, to the TIs below it).
- Collection uses the current published schema, holder proof and a fresh credential
  UUID, retaining the provisional registration alias. The certificate's record is
  registered after commit; before collection there is no record, and status
  decisions apply locally.
- Each TI has its own DID and purpose-separated keys. Public keys must be confirmed
  before activation. Key lookup uses the signed issuance timestamp, including its
  fractional seconds, and does not substitute a current key after failed history lookup.
- Verification checks signature, holder binding, disclosures, schema, trust and the
  certificate's record (TI, credential hash, validity, standing) separately. Public evidence excludes holder DID, raw tokens,
  private notes and salts. Disclosed attributes are encrypted, hidden at expiry
  and physically purged by the worker.
- Presentation results have one authorized reader. The first terminal callback wins;
  nonce, state and deadline remain bound. A holder's refusal (OpenID4VP error
  response `access_denied`, accepted only after the request object was fetched) is
  such a terminal answer, read as `declined`; error responses carry no proof, so
  anyone who saw the QR code could also send one. Registry fetches and DCQL claim
  paths are bounded; invalid envelopes do not expose attributes.
- Lifecycle decisions commit during provider outages. Execution requires a confirmed
  matching contract outcome. Retained signed transactions stay pinned to their
  network, contract and signer and are reconciled before replacement work.
- Audit and encrypted decision snapshots are distinct from timestamp transport.
  Cleanup removes only expired unused signing intents, not consumed signature
  evidence, decision history or immutable journal entries.
- The Wallet derives backup keys from its recovery phrase and encrypts/restores
  locally. Backup storage uses verified public material and opaque ciphertext,
  without a separate operator account or holder DID. Untrusted payload fields
  cannot replace the verified backup key.

## Failure behavior and limits

Business decisions commit before identifier-only Redis submissions. Failed
submission is logged; database safety sweeps recover pending work. Worker/API
lifetimes are independent. Graceful worker shutdown drains active jobs; forced
termination permits stalled redelivery. See [background execution](background.md)
for priorities, intervals, retry budgets and nonce ordering.

KMS may return a signature before PostgreSQL records it; that uncertainty window
cannot be recovered from a signature that was never persisted. Persisted signed
outcomes have durable reconciliation. A warm process can use already unwrapped
keys during an outage; a cold process refuses protected operations until KMS
returns. HTTP readiness proves schema/database access, not provider readiness.

Concurrent first backup inserts can produce one conflict. Deleting a backup
removes its version history; a still-fresh signed deletion can delete a recreated
row. These are current storage limits, not exactly-once or replay-history guarantees.

Real EBSI DID/TIR publication is manual; in development it goes through the
development EBSI service. Timestamps use Core v1 commit/reveal. See
[EBSI profiles](ebsi-profiles.md). LocalStack, the development EBSI service over
EBSI's registry contracts and local contracts are test providers; real provider
acceptance and native-device acceptance require their own validation.
