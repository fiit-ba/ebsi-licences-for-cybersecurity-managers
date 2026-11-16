#!/usr/bin/env bash
# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# Guard for a deploy-* Makefile target: refuse to deploy again over an
# existing, still-live record, unless FORCE says otherwise. A new contract
# means a new address, and (for the governance contract) new proposal
# numbers that orphan every case the back-office already points at an old
# one (GUIDE.md).
#
# "Still-live" is checked on chain, not just on disk: anvil is ephemeral, so
# a record left over from an earlier anvil session names addresses with
# nothing behind them on the fresh chain the next session starts. A record
# whose representative address has no code at the given RPC is treated the
# same as no record at all - redeploy, overwriting it.
#
# Usage: scripts/skip-if-deployed.sh <record-file-in-deployments/> <rpc-url> <address-jq-path> <force>
#   record-file     e.g. anvil.json, besu-ebsi.json
#   rpc-url         checked for code at the address below
#   address-jq-path a jq path into the record naming one representative
#                    deployed address, e.g. .CertificateGovernance.address
#   force           non-empty (e.g. "1") deploys anyway, even over a live record
#
# Exit 0 (deploy), or exit 1 after printing the existing record (skip).
set -euo pipefail

record_name=${1:?record file, e.g. anvil.json}
rpc_url=${2:?rpc url}
address_path=${3:?jq path to a representative deployed address}
force=${4:-}
record="deployments/${record_name}"

if [ -n "$force" ]; then
  exit 0
fi

if [ -f "$record" ]; then
  address=$(jq -r "$address_path" "$record" 2>/dev/null || true)
  if [ -n "$address" ] && [ "$address" != "null" ]; then
    code=$(cast code "$address" --rpc-url "$rpc_url" 2>/dev/null || echo "0x")
    if [ "$code" != "0x" ]; then
      echo "$record already exists and $address still has code; not redeploying (FORCE=1 to redeploy anyway):"
      jq . "$record"
      exit 1
    fi
    echo "$record exists, but $address has no code on $rpc_url (a reset chain, e.g. anvil restarted); redeploying."
  fi
fi

exit 0
