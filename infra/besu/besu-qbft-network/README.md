# Local Besu QBFT network

From the repository root:

```sh
cd infra/besu/besu-qbft-network
docker compose up -d
```

This starts four QBFT validators. Validator 1 exposes JSON-RPC at
`http://localhost:8545`, chain ID `1337`. The Compose project name is explicitly
`besu-qbft-network`. Genesis and development node keys remain in `networkFiles/`;
validator chain state is stored in the ignored `data/` directory.

Ordinary stop/start preserves chain state:

```sh
docker compose stop
docker compose up -d
```

For an intentional fresh chain, including after a genesis change, stop the nodes
before removing their databases. Run these commands from this network directory:

```sh
docker compose down
rm -rf ./data
docker compose up -d
```

A reset removes deployed contracts and their history. Deploy the governance
contract again from `contracts/` with `npm run deploy:besu`, then update its address
in `infra/.env` and the Wallet configuration. Continue with the normal product
Compose/bootstrap described in `docs/GUIDE.md` at the repository root.

## Block explorer

The repository does not include a block explorer, and neither the launcher nor
any Compose file starts one. To inspect the local chain, point any explorer that
reads Ethereum JSON-RPC at `http://localhost:8545` (from Docker Desktop
containers, `http://host.docker.internal:8545`).

An earlier version of this directory carried Web3 Labs' Chainlens explorer. Its
licence allows only internal, non-commercial evaluation and does not allow
redistribution, so it was removed. Anyone who fetches it from Web3 Labs
themselves may use it only on a development machine under Web3 Labs' own terms,
never in a hosted installation. The [third-party component list](../../../sbom/README.md)
records it as a development-only tool that is not distributed.
