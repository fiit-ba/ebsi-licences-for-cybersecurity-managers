# Background execution

The API (`server/http/start.ts`) and worker (`server/worker/start.ts`) run in
independent processes and Compose services. Both use the same image. The API
records business decisions and submits jobs; the worker reads current PostgreSQL
state and calls domain handlers. Restarting the API does not stop the worker.

## Queue and payloads

BullMQ 5.79.1 uses Redis DB 0, queue `plr`, and key prefix `atest-bullmq`.
`REDIS_BROKER_URL` must select DB 0. The exchange cache uses DB 2 of the same
instance through `PLR_REDIS_CACHE_URL`.

Jobs contain an operation and minimal record identifiers: certificate, proposal,
anchor, account or organization ID. Keys, tokens, private reasons, signed
transaction bytes and complete decisions stay outside the queue. Provider errors
are redacted before BullMQ records them. Terminal transport jobs are removed;
business outcomes and delivery intent remain in PostgreSQL and the application log.

All jobs share two execution slots by default (`PLR_WORKER_CONCURRENCY`).
Immediate collection and emergency standing jobs use priority 1; ordinary jobs
and standing-sweep jobs use priority 2. An urgent job runs before queued ordinary
work when a slot becomes free. Active jobs are not preempted.

## Domain operations

| Operation                       | Current handler                                                        | Delivery behavior                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `record-standing`               | Issuance registration and lifecycle emergency delivery                 | Read the collected certificate, serialize on its database row, verify the exact contract outcome.      |
| `submit-governance-proposal`    | Lifecycle proposal phase                                               | Open only a still-eligible case whose certificate record and reason commitment match.                  |
| `submit-governance-signature`   | Lifecycle signature phase                                              | Require independent human approval and wait for proposal submission.                                   |
| `reconcile-governance-proposal` | Lifecycle reconciliation phase                                         | Observe quorum, expiry and timelock; apply only a confirmed eligible outcome.                          |
| `withdraw-governance-proposal`  | Lifecycle rejection, withdrawal and organization cancellation delivery | Veto or reconcile the exact case without creating a replacement decision.                              |
| `submit-timestamp`              | Audit anchor delivery                                                  | Process retained intents in nonce order; verify decision/journal digests and exact timestamp evidence. |
| `send-recovery`                 | Identity recovery/activation delivery                                  | Reconstruct the same durable challenge for the current eligible account.                               |
| `withdraw-accreditation`        | Accreditation withdrawal delivery                                      | Retry pending development-registry acknowledgement; real EBSI publication is manual.                   |
| `onboard-issuer`                | Development onboarding of a newly registered TI                        | Publish its DID, keys and accreditation and set it up on the governance contract, as synchronization.  |

Standing, proposal, withdrawal and timestamp jobs allow five retries after the
first attempt. Their custom `full-jitter` backoff chooses an integer number of
seconds from zero through `min(600, 2^(failedAttempt-1))`. A signature awaiting
its proposal retries after three seconds, up to twenty times; other signature
failures have five retries. Reconciliation allows three retries at a fixed
120-second delay. Local integrity refusals in standing/governance dispatch do not
retry automatically. Mail, accreditation withdrawal, issuer onboarding and maintenance jobs have one
transport attempt; pending database work is rediscovered by safety sweeps, and
`npm run sync:registry:development` publishes a TI whose onboarding failed.

## Periodic reconciliation

The worker registers six stable scheduler IDs with BullMQ. Repeated registration
preserves one schedule per ID. New schedules first run after their interval;
Redis reconnect restores missing schedules without requiring an API restart.

| Scheduler                       | Default interval | Responsibility                                                                                                         |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sweep-governance`              | 120 seconds      | Queue pending cases, withdrawals and recovery messages; purge expired recovery state and reconcile signature evidence. |
| `sweep-standing`                | 60 seconds       | Queue collected certificates with missing registration or pending emergencies, then refresh ledger observations.       |
| `sweep-timestamps`              | 600 seconds      | Queue unconfirmed anchors with retained signed bytes or fewer than 50 attempts.                                        |
| `purge-signing-intents`         | 3,600 seconds    | Delete only expired, unused signing intents.                                                                           |
| `purge-presentation-attributes` | 300 seconds      | Remove expired encrypted attributes and spent/expired request state while retaining public evidence.                   |
| `revalidate-accreditation`      | 86,400 seconds   | Revalidate configured issuer accreditation for supported schemas.                                                      |

`PLR_GOVERNANCE_RECONCILE_SECONDS` and `PLR_STANDING_SWEEP_SECONDS` override the
first two intervals. The standing sweep inspects at most 400 candidates and
submits at most 200 jobs. BullMQ deduplication gives each certificate a 300-second
sweep lease; immediate urgent submissions do not wait for that lease.

## Commit, retry and blockchain boundaries

A business transaction registers in-memory callbacks, commits PostgreSQL, releases
its connection, then submits concrete tasks. Rollback or failed commit discards
callbacks. A failed broker submission is logged and does not undo the decision.
Periodic database reconciliation recovers a crash between commit and submission;
there is no atomic PostgreSQL/Redis commit or exactly-once guarantee.

Domain handlers retain certificate/case locks and signer advisory locks. A signed
transaction remains bound to its chain, contract, signer, intent, hash and nonce.
An uncertain transaction is reconciled using retained bytes and observed ledger
state before another signature or nonce is allocated. Human roles, independent
approval, contract quorum, commitments, salts and immutable audit remain domain
responsibilities. Completing a BullMQ job is not blockchain confirmation.

Graceful shutdown stops admission and drains active jobs before providers and
PostgreSQL close. BullMQ renews active locks and recovers stalled deliveries after
forced termination. During a broker outage acknowledgement may wait for
reconnection; Compose grants 90 seconds before forced shutdown.

## File ownership

| File                                  | Responsibility                                                             |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `server/background/types.ts`          | Task payload union and retryable proposal-wait result.                     |
| `queue.ts`                            | DB-0 validation, task options and short-lived post-commit producers.       |
| `handlers.ts`                         | Dispatch to existing domains and expand safety sweeps into concrete tasks. |
| `schedules.ts`                        | Stable scheduler IDs and intervals.                                        |
| `runtime.ts`                          | Consumer connections, backoff, schedule restoration and shutdown.          |
| `server/worker/start.ts`, `health.ts` | Worker entry point and health check.                                       |
| `server/runtime.ts`                   | Shared domain composition without an HTTP listener or background timers.   |

## Operation and Redis persistence

Compose starts both processes automatically:

```sh
cd infra
docker compose up --build -d
./bootstrap.sh
```

Host-native operation requires `npm start` and `npm run worker` in separate
terminals with the same domain environment. `npm run health:worker` checks the
worker's named Redis connection, six schedulers and PostgreSQL. HTTP readiness
checks database/schema availability.

Both Compose templates use `redis:7`. BullMQ was locally tested against Redis
7.4.11. Development uses image defaults, `restart: unless-stopped`, no explicit
AOF setting and no named Redis volume. Default snapshotting is enabled. Hosted
Redis requires `REDIS_PASSWORD`, `--appendonly yes` and `redisdata:/data`.
Persistence applies to all logical databases, including expiring DB-2 cache data.
TTL does not mean temporary data cannot reach disk. Preserve existing volumes.

See [validation](validation.md) for checks and [configuration](configuration.md)
for provider settings. The worker onboards TIs only in development, through the
development EBSI service; real EBSI onboarding stays manual.
