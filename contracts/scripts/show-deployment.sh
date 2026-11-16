#!/usr/bin/env bash
# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# Print both of a network's deployment records: the governance contract
# (deployments/<network>.json, Deploy.s.sol) and the EBSI mock registries
# (deployments/<network>-ebsi.json, DeployEBSI.s.sol). Called from the
# Makefile (`make show-anvil`, `make show-besu`); run directly as:
#
#   scripts/show-deployment.sh <label>
set -euo pipefail

label=${1:?label (e.g. anvil, besu)}
found=0

governance="deployments/${label}.json"
if [ -f "$governance" ]; then
  echo "--- governance ($governance) ---"
  jq . "$governance"
  found=1
fi

ebsi="deployments/${label}-ebsi.json"
if [ -f "$ebsi" ]; then
  [ "$found" = 1 ] && echo
  echo "--- EBSI mocks ($ebsi) ---"
  jq . "$ebsi"
  found=1
fi

if [ "$found" = 0 ]; then
  echo "No deployments/${label}.json or deployments/${label}-ebsi.json: deploy first."
fi
