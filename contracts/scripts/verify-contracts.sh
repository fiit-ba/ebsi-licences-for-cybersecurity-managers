#!/usr/bin/env bash
# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# Verify the governance contract's three on-chain pieces (DECISIONS.md D45:
# an implementation, an UpgradeableBeacon, a BeaconProxy), and, when
# deployments/<label>-ebsi.json exists, each EBSI mock registry's
# implementation and ERC1967Proxy - against a running forge
# verify-contract-compatible verifier. Called from the Makefile
# (`make verify-anvil`, `make verify-besu`); run directly as:
#
#   scripts/verify-contracts.sh <label> <rpc-url> <verifier> <verifier-url> <verifier-api-key>
#
# `label` names deployments/<label>.json, the record `scripts/Deploy.s.sol`
# wrote. `verifier` is forge's `--verifier`: sourcify (default, no API key,
# but its public instance only knows the chains it is configured for - a
# private network's own chain id is not one of them), blockscout, etherscan,
# oklink, or custom. For a self-hosted Blockscout instance:
#   verifier=blockscout  verifier-url=https://<host>/api
# (Blockscout's Etherscan-compatible API); `verifier-api-key` only if that
# instance requires one.
set -euo pipefail

label=${1:?label (e.g. anvil, besu)}
rpc_url=${2:?rpc url}
verifier=${3:-sourcify}
verifier_url=${4:-}
verifier_api_key=${5:-}

record="deployments/${label}.json"
ebsi_record="deployments/${label}-ebsi.json"
if [ ! -f "$record" ] && [ ! -f "$ebsi_record" ]; then
  echo "No $record or $ebsi_record: deploy first (make deploy-$label or deploy-ebsi-$label)." >&2
  exit 1
fi

chain=$(cast chain-id --rpc-url "$rpc_url")

verifier_args=(--verifier "$verifier")
[ -n "$verifier_url" ] && verifier_args+=(--verifier-url "$verifier_url")
[ -n "$verifier_api_key" ] && verifier_args+=(--verifier-api-key "$verifier_api_key")

echo "network        : $label (chain $chain)"
echo "verifier       : $verifier${verifier_url:+ @ $verifier_url}"
echo

verify() {
  local what=$1 address=$2 contract=$3
  shift 3
  echo "--- $what: $address ---"
  forge verify-contract --chain "$chain" --rpc-url "$rpc_url" "$address" "$contract" "${verifier_args[@]}" "$@" --watch
}

# A proxy's constructor (ERC1967Proxy, BeaconProxy) takes (address, bytes):
# the second argument is dynamic, and forge's --guess-constructor-args does
# not reliably split a dynamic tail off the matched creation bytecode prefix
# for it ("Local bytecode doesn't match on-chain bytecode", though the code
# itself matches byte for byte - only the encoded constructor data follows).
# So the arguments are read from the real creation transaction instead: its
# input, with the known local creation bytecode's length stripped off the
# front, is exactly the ABI-encoded constructor arguments.
#
# This needs Blockscout's own API to find the creation transaction (there is
# no cheaper way to go from an address to the transaction that created it);
# without a Blockscout verifier_url, or if the lookup fails for any reason,
# it falls back to --guess-constructor-args.
verify_proxy() {
  local what=$1 address=$2 contract=$3

  local creation_args=""
  if [ "$verifier" = "blockscout" ] && [ -n "$verifier_url" ]; then
    local base creation_tx local_bytecode onchain_input artifact
    base=$(printf '%s' "$verifier_url" | sed -E 's#/api/?\??$##')
    creation_tx=$(curl -s "${base}/api/v2/addresses/${address}" 2>/dev/null \
      | jq -r '.creation_transaction_hash // empty' 2>/dev/null || true)
    if [ -n "$creation_tx" ]; then
      onchain_input=$(cast rpc eth_getTransactionByHash "\"$creation_tx\"" --rpc-url "$rpc_url" 2>/dev/null \
        | jq -r '.input // empty' 2>/dev/null || true)
      # The real build artifact, not `forge inspect`: inspecting a vendor
      # file in isolation compiles it as its own standalone unit, and the
      # optimizer (via-ir especially) can inline differently there than in
      # the actual multi-file build that produced the deployed bytecode.
      artifact="out/$(basename "${contract%%:*}")/${contract##*:}.json"
      local_bytecode=$(jq -r '.bytecode.object // empty' "$artifact" 2>/dev/null || true)
      if [ -n "$onchain_input" ] && [ -n "$local_bytecode" ] \
        && [ "${onchain_input:0:${#local_bytecode}}" = "$local_bytecode" ]; then
        creation_args="0x${onchain_input:${#local_bytecode}}"
      fi
    fi
  fi

  echo "--- $what: $address ---"
  if [ -n "$creation_args" ]; then
    forge verify-contract --chain "$chain" --rpc-url "$rpc_url" "$address" "$contract" \
      "${verifier_args[@]}" --constructor-args "$creation_args" --watch
  else
    echo "(could not read the real constructor arguments from the creation transaction; guessing)"
    forge verify-contract --chain "$chain" --rpc-url "$rpc_url" "$address" "$contract" \
      "${verifier_args[@]}" --guess-constructor-args --watch
  fi
}

# --- Governance contract, if deployed ------------------------------------------

if [ -f "$record" ]; then
  implementation=$(jq -r '.CertificateGovernance.implementation' "$record")
  beacon=$(jq -r '.CertificateGovernance.beacon' "$record")
  proxy=$(jq -r '.CertificateGovernance.address' "$record")

  # The implementation: our own, audited code. Its constructor takes nothing.
  verify "implementation" "$implementation" "contracts/CertificateGovernance.sol:CertificateGovernance"

  # The beacon and the proxy are OpenZeppelin's own contracts (verifying them
  # confirms the deployed bytecode matches the published source, nothing about
  # our code); --guess-constructor-args reads their arguments from the chain
  # rather than re-encoding them here.
  beacon_source=$(find dependencies -name UpgradeableBeacon.sol -path '*/proxy/beacon/*' | head -1)
  proxy_source=$(find dependencies -name BeaconProxy.sol -path '*/proxy/beacon/*' | head -1)
  if [ -z "$beacon_source" ] || [ -z "$proxy_source" ]; then
    echo "OpenZeppelin's beacon/proxy sources are not in dependencies/; run 'forge soldeer install' first." >&2
    exit 1
  fi
  verify "beacon" "$beacon" "${beacon_source}:UpgradeableBeacon" --guess-constructor-args
  verify_proxy "proxy" "$proxy" "${proxy_source}:BeaconProxy"
else
  echo "No $record: skipping the governance contract (make deploy-$label to deploy it)."
fi

# --- EBSI mock registries (local/ebsi-mock), if deployed ----------------------
# Each one is its own implementation behind its own ERC1967Proxy
# (SetupEBSIInfrastructure.s.sol), not a beacon; DeployEBSI.s.sol records only
# the proxy's address, so the implementation is read from the proxy's
# EIP-1967 storage slot instead of a JSON field.

if [ -f "$ebsi_record" ]; then
  echo
  echo "=== EBSI mock registries ($ebsi_record) ==="

  erc1967_proxy_source=$(find dependencies -name ERC1967Proxy.sol -path '*/proxy/ERC1967/*' | head -1)
  if [ -z "$erc1967_proxy_source" ]; then
    echo "OpenZeppelin's ERC1967Proxy source is not in dependencies/; run 'forge soldeer install' first." >&2
    exit 1
  fi
  # The EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1.
  impl_slot=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc

  # JSON key : contract name : source file, one registry per line.
  registries='
PolicyRegistry:PoliciesRegistry:local/ebsi-mock/policies-registry/PolicyRegistry.sol
DidRegistry:DidRegistry:local/ebsi-mock/did-registry/DidRegistry.sol
IssuersRegistry:IssuersRegistry:local/ebsi-mock/issuers-registry/IssuersRegistry.sol
SchemasRegistry:SchemasRegistry:local/ebsi-mock/schemas-registry/SchemasRegistry.sol
Timestamp:Timestamp:local/ebsi-mock/timestamp/Timestamp.sol
ProxyTemplateRegistry:ProxyTemplatesRegistry:local/ebsi-mock/contract-factory/ProxyTemplateRegistry.sol
ProxyFactory:ProxyFactory:local/ebsi-mock/contract-factory/ProxyFactory.sol
'
  while IFS=: read -r key contract source; do
    [ -z "$key" ] && continue
    registry_proxy=$(jq -r --arg k "$key" '.ebsi[$k].contractAddress // empty' "$ebsi_record")
    if [ -z "$registry_proxy" ]; then
      echo "$key: not in $ebsi_record, skipping"
      continue
    fi
    registry_impl=$(cast storage "$registry_proxy" "$impl_slot" --rpc-url "$rpc_url" | cast parse-bytes32-address)
    verify "$key implementation" "$registry_impl" "${source}:${contract}"
    verify_proxy "$key proxy" "$registry_proxy" "${erc1967_proxy_source}:ERC1967Proxy"
  done <<< "$registries"
else
  echo "No $ebsi_record: skipping the EBSI mocks (make deploy-ebsi-$label to deploy them)."
fi
