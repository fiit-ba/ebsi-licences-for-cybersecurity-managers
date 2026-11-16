#!/usr/bin/env bash
# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# Integration tests: deploy everything to a fresh anvil the way the
# deployment scripts deploy it, then run the scenarios against it.
#
#   1. EBSI's contracts (DeployEBSI.s.sol)
#   2. CertificateRegistry and CertificateGovernance through EBSI's Proxy
#      Factory (Deploy.s.sol)
#   3. the RootTAO, the TAO, the TI and NBÚ in the DID and Trusted Issuers
#      Registries (SeedEbsi.s.sol)
#   4. the TI on the governance contract, NBÚ as its cosigner (AddTi.s.sol)
#   5. a suspension, a revocation held by its timelock and a veto, as signed
#      transactions (VerifyOnchain.s.sol)
#   6. the scenarios in test/integration/, on a fork of that chain
#
# Usage (from contracts/, or `make integration`):
#   scripts/integration-test.sh [extra forge test arguments, e.g. -vvv]
#
# INTEGRATION_PORT (default 8546) is the anvil port; it must be free, so a
# development anvil on 8545 is left alone. deployments/anvil*.json are
# replaced while the tests run and put back afterwards. forge reads
# contracts/.env, so a GOVERNANCE_* value set there applies here too.
set -euo pipefail
cd "$(dirname "$0")/.."

port=${INTEGRATION_PORT:-8546}
rpc="http://127.0.0.1:${port}"
records=(deployments/anvil.json deployments/anvil-ebsi.json)
backup=$(mktemp -d)
anvil_pid=

cleanup() {
  if [ -n "$anvil_pid" ]; then kill "$anvil_pid" 2>/dev/null || true; fi
  for record in "${records[@]}"; do
    rm -f "$record"
    if [ -f "$backup/$(basename "$record")" ]; then cp "$backup/$(basename "$record")" "$record"; fi
  done
  rm -rf "$backup"
}
trap cleanup EXIT

for record in "${records[@]}"; do
  if [ -f "$record" ]; then cp "$record" "$backup/"; fi
done
# Not in git (the records are local), so absent on a fresh checkout.
mkdir -p deployments

if cast chain-id --rpc-url "$rpc" >/dev/null 2>&1; then
  echo "Something already answers at $rpc; set INTEGRATION_PORT to a free port." >&2
  exit 1
fi
anvil --port "$port" --silent &
anvil_pid=$!
for _ in $(seq 50); do
  cast chain-id --rpc-url "$rpc" >/dev/null 2>&1 && break
  sleep 0.2
done
cast chain-id --rpc-url "$rpc" >/dev/null

step() { printf '\n== %s\n' "$1"; }

step "EBSI contracts"
forge script scripts/DeployEBSI.s.sol --rpc-url "$rpc" --broadcast --slow >/dev/null

step "CertificateRegistry and CertificateGovernance"
forge script scripts/Deploy.s.sol --rpc-url "$rpc" --broadcast >/dev/null

step "DIDs and accreditations"
seed=$(forge script scripts/SeedEbsi.s.sol --rpc-url "$rpc" --broadcast --slow)
TI_DID=$(sed -n 's/^ *TI_DID=//p' <<<"$seed")
TI_ATTRIBUTE_ID=$(sed -n 's/^ *TI_ATTRIBUTE_ID=//p' <<<"$seed")
COSIGNER_DID=$(sed -n 's/^ *COSIGNER_DID=//p' <<<"$seed")
export TI_DID TI_ATTRIBUTE_ID COSIGNER_DID
echo "TI $TI_DID, cosigner $COSIGNER_DID"

step "The TI on the governance contract"
forge script scripts/AddTi.s.sol --rpc-url "$rpc" --broadcast >/dev/null

step "Signed transactions: suspension, revocation, veto"
forge script scripts/VerifyOnchain.s.sol --rpc-url "$rpc" --broadcast --slow | sed -n '/== Logs ==/,/^$/p'

step "Scenarios"
PLR_INTEGRATION=true forge test --match-path "test/integration/*" --fork-url "$rpc" "$@"
