# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# Deployment entry points for the governance contract (component 10,
# DECISIONS.md D25) and the EBSI mock registries (local/ebsi-mock) it reads
# in development.
#
# Two networks:
#   anvil - an ephemeral local chain; the development keys are acceptable
#           (scripts/Networks.sol), so no .env is required.
#   besu  - whatever Besu network answers at BESU_RPC_URL: the local
#           infra/besu/besu-qbft-network, or a shared testnet. Off a
#           development chain id, Deploy.s.sol requires every role's key,
#           the deployer's key and the beacon owner by name - fill them into
#           .env (see .env.example) before `make deploy-besu`.
#
# `forge script` reads contracts/.env itself; this file reads it too
# (-include below), for the pieces .env can't drive on its own: the RPC URL
# used outside a script (chain id lookups, verification) and this file's own
# defaults.
#
# Usage:
#   make help
#   make deploy-anvil
#   make deploy-besu DRY_RUN=1        # dry run against the real RPC, nothing broadcast
#   make deploy-besu VERIFY=1          # also verify afterwards (ignored with DRY_RUN)
#   make deploy-besu FORCE=1          # redeploy even though a record already exists
#   make verify-besu                   # verify again, or on its own
#
# A deploy-* target that finds its deployment record already there, with
# code still at the address it names, does not deploy again: a new contract
# means a new address, and (for the governance contract) new proposal
# numbers that orphan every case the back-office already points at an old
# one. It prints the existing record instead. FORCE=1 deploys anyway. A
# record whose address has no code where it should (anvil reset since) is
# treated as if it were not there, and redeployed without FORCE.
#
# deploy-anvil and deploy-besu both depend on their deploy-ebsi-* target:
# the governance contract deploys through the EBSI mock infrastructure's
# Proxy Templates Registry and Proxy Factory (component 10.0), which
# Deploy.s.sol only ever reads from deployments/<network>-ebsi.json, never
# deploys itself (a `forge script --broadcast` runs its own body twice, so a
# decision made there from whether that file exists already would see its
# own first pass's file in its second - see Deploy.s.sol's header comment).
#
# ANVIL_DEPLOYER / BESU_DEPLOYER (private keys) pay for and sign each
# network's deployments, per network rather than one shared
# GOVERNANCE_DEPLOYER_KEY; left unset, Deploy.s.sol falls back to its own
# default (a development key on anvil, required by name on besu).

.DEFAULT_GOAL := help
.ONESHELL:
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

-include .env
export

ANVIL_RPC_URL ?= http://127.0.0.1:8545
BESU_RPC_URL  ?= http://127.0.0.1:8545

# Per-network deployer keys (private keys); see the header comment above.
ANVIL_DEPLOYER ?=
BESU_DEPLOYER  ?=

# Contract source verification: `VERIFY=1` on a deploy-* target runs it right
# after deploying; `make verify-<network>` runs it again later, against the
# existing deployment record. VERIFIER is forge's --verifier (sourcify,
# blockscout, etherscan, oklink, custom); sourcify needs no key but its
# public instance only knows the chains it is configured for - a private
# network's chain id is not one of them. For a self-hosted Blockscout:
# VERIFIER=blockscout VERIFIER_URL=https://<host>/api.
VERIFIER         ?= sourcify
VERIFIER_URL     ?=
VERIFIER_API_KEY ?=

.PHONY: help install build test integration anvil \
        deploy-anvil deploy-besu deploy-ebsi-anvil deploy-ebsi-besu add-ti-anvil add-ti-besu \
        verify-besu show-anvil show-besu clean

help: ## This list
	@echo "Usage: make <target> [VAR=value ...]"
	@echo
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sort | awk -F':.*##' '{printf "  %-20s %s\n", $$1, $$2}'

install: ## Fetch the Solidity dependencies (forge-std, OpenZeppelin, Soldeer)
	forge soldeer install

build: ## Compile the contracts
	forge build

test: ## Run the test suite and check the generated interface copies
	forge test
	node scripts/export-abi.js --check

integration: build ## Deploy everything to a fresh anvil and run the scenarios in test/integration/ (INTEGRATION_PORT, default 8546)
	scripts/integration-test.sh

anvil: ## Run a local development chain at ANVIL_RPC_URL (foreground)
	port=$$(printf '%s' "$(ANVIL_RPC_URL)" | sed -E 's#.*:([0-9]+)/?$$#\1#')
	anvil --port "$$port"

# Each recipe below exports ANVIL_DEPLOYER/BESU_DEPLOYER as the
# GOVERNANCE_DEPLOYER_KEY the scripts read, but only when it is actually set:
# an empty GOVERNANCE_DEPLOYER_KEY would still count as "set" to forge and
# fail to parse, where leaving it untouched lets Deploy.s.sol's own fallback
# (a development key on anvil, required by name on besu) apply instead. The
# export has to happen in the same recipe as the forge call: a prerequisite
# target's recipe runs in its own shell, even under .ONESHELL.

# --- Governance contract ------------------------------------------------------

deploy-anvil: build deploy-ebsi-anvil ## Deploy the governance contract to anvil, through the EBSI mock infrastructure (skips if deployed; FORCE=1 to redeploy; DRY_RUN=1 to simulate)
	if [ -n "$(ANVIL_DEPLOYER)" ]; then export GOVERNANCE_DEPLOYER_KEY="$(ANVIL_DEPLOYER)"; fi
ifdef DRY_RUN
	forge script scripts/Deploy.s.sol --rpc-url "$(ANVIL_RPC_URL)"
else
	if scripts/skip-if-deployed.sh anvil.json "$(ANVIL_RPC_URL)" ".CertificateGovernance.address" "$(FORCE)"; then
		forge script scripts/Deploy.s.sol --rpc-url "$(ANVIL_RPC_URL)" --broadcast
	fi
endif

deploy-besu: build deploy-ebsi-besu ## Deploy the governance contract to besu, through the EBSI mock infrastructure (skips if deployed; FORCE=1 to redeploy; DRY_RUN=1 to simulate; VERIFY=1 to verify)
	if [ -n "$(BESU_DEPLOYER)" ]; then export GOVERNANCE_DEPLOYER_KEY="$(BESU_DEPLOYER)"; fi
ifdef DRY_RUN
	forge script scripts/Deploy.s.sol --rpc-url "$(BESU_RPC_URL)"
else
	if scripts/skip-if-deployed.sh besu.json "$(BESU_RPC_URL)" ".CertificateGovernance.address" "$(FORCE)"; then
		forge script scripts/Deploy.s.sol --rpc-url "$(BESU_RPC_URL)" --broadcast
ifdef VERIFY
		$(MAKE) verify-besu
endif
	fi
endif

# --- TIs ------------------------------------------------------------------------
# The TI's accreditation and keys must be in the EBSI registries first;
# scripts/AddTi.s.sol names what it reads (TI_DID, TI_ATTRIBUTE_ID, ...).

add-ti-anvil: build ## Set up a TI on the anvil contract, as the TAO
	forge script scripts/AddTi.s.sol --rpc-url "$(ANVIL_RPC_URL)" --broadcast

add-ti-besu: build ## Set up a TI on the besu contract, as the TAO
	forge script scripts/AddTi.s.sol --rpc-url "$(BESU_RPC_URL)" --broadcast

# --- EBSI mock registries (local/ebsi-mock) -----------------------------------

deploy-ebsi-anvil: build ## Deploy the EBSI mock registries to anvil (skips if deployed; FORCE=1 to redeploy; DRY_RUN=1 to simulate)
	if [ -n "$(ANVIL_DEPLOYER)" ]; then export GOVERNANCE_DEPLOYER_KEY="$(ANVIL_DEPLOYER)"; fi
ifdef DRY_RUN
	forge script scripts/DeployEBSI.s.sol --rpc-url "$(ANVIL_RPC_URL)"
else
	if scripts/skip-if-deployed.sh anvil-ebsi.json "$(ANVIL_RPC_URL)" ".ebsi.ProxyFactory.contractAddress" "$(FORCE)"; then
		forge script scripts/DeployEBSI.s.sol --rpc-url "$(ANVIL_RPC_URL)" --broadcast --slow
	fi
endif

deploy-ebsi-besu: build ## Deploy the EBSI mock registries to besu (skips if deployed; FORCE=1 to redeploy; DRY_RUN=1 to simulate)
	if [ -n "$(BESU_DEPLOYER)" ]; then export GOVERNANCE_DEPLOYER_KEY="$(BESU_DEPLOYER)"; fi
ifdef DRY_RUN
	forge script scripts/DeployEBSI.s.sol --rpc-url "$(BESU_RPC_URL)"
else
	if scripts/skip-if-deployed.sh besu-ebsi.json "$(BESU_RPC_URL)" ".ebsi.ProxyFactory.contractAddress" "$(FORCE)"; then
		forge script scripts/DeployEBSI.s.sol --rpc-url "$(BESU_RPC_URL)" --broadcast --slow
	fi
endif

# --- Verification --------------------------------------------------------------
# Besu only: anvil is ephemeral and local, so no verifier (not even a
# self-hosted one) would ever have a reason to reach it.

verify-besu: ## Verify the governance contracts deployed to besu
	scripts/verify-contracts.sh besu "$(BESU_RPC_URL)" "$(VERIFIER)" "$(VERIFIER_URL)" "$(VERIFIER_API_KEY)"

# --- Housekeeping ----------------------------------------------------------------

show-anvil: ## Print the anvil deployment records (governance and EBSI mocks)
	scripts/show-deployment.sh anvil

show-besu: ## Print the besu deployment records (governance and EBSI mocks)
	scripts/show-deployment.sh besu

clean: ## Remove build artifacts (never deployments/ or .env)
	rm -rf out cache broadcast
