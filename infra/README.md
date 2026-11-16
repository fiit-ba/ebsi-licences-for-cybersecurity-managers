# Product infrastructure

Follow [installation](../docs/GUIDE.md) for the ordinary TypeScript backend,
frontend, Wallet configuration, empty PostgreSQL bootstrap and KMS ceremonies.
`docker-compose.yml` is the normal development stack; `docker-compose.prod.yml`
is the hosted configuration template, described in [hosted setup](../docs/PRODUCTION.md).

API/console (`backend`) and BullMQ (`worker`) use one image with independent
commands, health checks and shutdown. PostgreSQL migrations precede readiness.
One Redis provides broker DB 0 and cache DB 2. LocalStack supplies development KMS,
and `ebsi-mock` serves EBSI's Core API v1 over EBSI's registry contracts on the
ledger ([development EBSI service](ebsi-mock/README.md)).

The Besu development ledger lives in `besu/besu-qbft-network/` and runs as
a separate Compose project. Start it there with `docker compose up -d` before
deploying the contracts (EBSI's registries, the certificate registry and its
governance) and starting this stack. Its address, chain and contract addresses are
explicit configuration; `ebsi-mock` reads the deployed addresses from
`contracts/deployments` (`PLR_DEPLOYMENTS_DIR`).
The hosted template uses external KMS/EBSI/ledger and an mTLS edge sidecar.
No command here deploys externally or starts the native Wallet automatically.

Redis keeps `redis:7` local defaults without explicit AOF or a named
volume. Hosted Redis requires `REDIS_PASSWORD`, enables AOF and reuses
`redisdata:/data`. Persistence applies to **all logical databases**, including
expiring cache data; expiry does not promise absence of temporary data on disk.
See [background execution and recovery](../back-office/docs/background.md).
