#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
INFRA_PROJECT_NAME="${PLR_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-plr-local}}"
CONTRACT_CHANGED=0
DEV_WEB_ENABLED="${DEV_WEB:-1}"

mkdir -p "$LOG_DIR" "$PID_DIR"
printf '%s\n' "$INFRA_PROJECT_NAME" > "$RUN_DIR/compose-project"
unset COMPOSE_PROJECT_NAME

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  [ok] %s\n" "$*"; }
warn() { printf "  [warn] %s\n" "$*"; }
fail() { printf "  [error] %s\n" "$*" >&2; exit 1; }

load_node_env() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    nvm use --silent 24 >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1 || true
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

check_node_version() {
  node -e '
    const major = Number(process.versions.node.split(".")[0]);
    if (major !== 24) {
      console.error(`Node ${process.versions.node} is unsupported by back-office; use Node 24.`);
      process.exit(1);
    }
  ' || fail "Activate Node 24 with: nvm use 24"
}

docker_ready() {
  docker info >/dev/null 2>&1
}

ensure_docker() {
  local output=""
  if docker_ready; then
    return 0
  fi

  output="$(docker info 2>&1 || true)"
  if printf '%s' "$output" | grep -qi "permission denied"; then
    fail "Docker socket permission denied. Run this script from your normal Terminal."
  fi

  if command -v open >/dev/null 2>&1; then
    warn "Docker is not ready; trying to start OrbStack or Docker Desktop"
    open -ga OrbStack >/dev/null 2>&1 || open -ga Docker >/dev/null 2>&1 || true
    for _ in $(seq 1 90); do
      if docker_ready; then
        ok "Docker is ready"
        return 0
      fi
      sleep 2
    done
  fi

  fail "Docker is not running. Start Docker/OrbStack and run ./start-mvp.sh again."
}

check_public_port() {
  local port="$1"
  local owners=""

  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi

  owners="$(docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null || true)"
  if [ -n "$owners" ] && printf '%s\n' "$owners" | grep -q "^${INFRA_PROJECT_NAME}-"; then
    return 0
  fi

  fail "Port $port is already in use${owners:+ by $owners}. Stop the previous stack, then rerun ./start-mvp.sh."
}

detect_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 !~ /^127\./ {print $2; exit}')"
  [ -n "$ip" ] || fail "Could not detect a LAN IP. Run with PLR_PUBLIC_HOST=your.ip.address."
  printf '%s' "$ip"
}

ensure_env_file() {
  local file="$1"
  local example="$2"
  if [ ! -f "$file" ]; then
    cp "$example" "$file"
    ok "created ${file#$ROOT/}"
  fi
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp="${file}.tmp"

  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      done = 1
      next
    }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

set_ios_ats_host() {
  local host="$1"
  local plist="$ROOT/holder-wallet/ios/atestwallet/Info.plist"
  local host_file="$RUN_DIR/ios-ats-host"
  local previous_host=""

  if [ ! -f "$plist" ]; then
    warn "Could not add the iOS HTTP exception for $host"
    return 0
  fi

  previous_host="$(sed -n '1p' "$host_file" 2>/dev/null || true)"
  node - "$plist" "$previous_host" "$host" <<'NODE'
const fs = require('node:fs');
const [file, previous, current] = process.argv.slice(2);
let xml = fs.readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exception = (host) =>
  `\t\t\t<key>${host}</key>\n` +
  `\t\t\t<dict>\n` +
  `\t\t\t\t<key>NSExceptionAllowsInsecureHTTPLoads</key>\n` +
  `\t\t\t\t<true/>\n` +
  `\t\t\t</dict>\n`;
if (previous && previous !== current) {
  xml = xml.replace(new RegExp(escape(exception(previous))), '');
}
if (!xml.includes(`<key>${current}</key>`)) {
  const marker = '\t\t\t<key>localhost</key>\n';
  if (!xml.includes(marker)) throw new Error('NSExceptionDomains localhost marker is missing');
  xml = xml.replace(marker, exception(current) + marker);
}
fs.writeFileSync(file, xml);
NODE
  printf '%s\n' "$host" > "$host_file"
}

dependency_fingerprint() {
  local dir="$1"
  shift
  (
    cd "$dir"
    for file in "$@"; do
      [ -f "$file" ] && shasum -a 256 "$file"
    done
  ) | shasum -a 256 | awk '{print $1}'
}

ensure_npm_dependencies() {
  local name="$1"
  local dir="$2"
  local stamp="$RUN_DIR/deps-${name}.sha256"
  local current=""

  current="$(dependency_fingerprint "$dir" package.json package-lock.json)"
  if [ ! -d "$dir/node_modules" ] || [ "$(sed -n '1p' "$stamp" 2>/dev/null || true)" != "$current" ]; then
    say "Installing $name dependencies"
    (cd "$dir" && npm ci --no-audit --no-fund)
    printf '%s\n' "$current" > "$stamp"
  fi
}

ensure_yarn_dependencies() {
  local name="$1"
  local dir="$2"
  local stamp="$RUN_DIR/deps-${name}.sha256"
  local current=""

  current="$(dependency_fingerprint "$dir" package.json yarn.lock)"
  if [ ! -d "$dir/node_modules" ] || [ "$(sed -n '1p' "$stamp" 2>/dev/null || true)" != "$current" ]; then
    say "Installing $name dependencies"
    # CI makes patch-package fail instead of silently returning success when a
    # native compatibility patch cannot be applied. --force refreshes a stale,
    # previously patched node_modules tree after the lockfile changes.
    (cd "$dir" && CI=true yarn install --frozen-lockfile --force)
    printf '%s\n' "$current" > "$stamp"
  fi
}

# The TAO the development contracts are deployed for; the back-office's seed binds its TAO to it.
DEVELOPMENT_TAO_DID="did:ebsi:zmQaJTYt1ftvnjrwxWpPDUX"

deployment_value() {
  local file="$ROOT/contracts/deployments/besu.json"
  [ -f "$file" ] || return 0
  jq -r "$1 // empty" "$file" 2>/dev/null || true
}

contract_sources_hash() {
  (
    cd "$ROOT/contracts"
    {
      find contracts local config scripts -type f \( -name '*.sol' -o -name '*.js' -o -name '*.json' -o -name '*.sh' \) -print
      printf '%s\n' foundry.toml soldeer.lock remappings.txt Makefile
    } | LC_ALL=C sort | while IFS= read -r file; do
      [ -f "$file" ] && shasum -a 256 "$file"
    done
  ) | shasum -a 256 | awk '{print $1}'
}

runtime_sources_hash() {
  {
    git -C "$ROOT" rev-parse HEAD
    git -C "$ROOT" diff --binary -- back-office infra/ebsi-mock
    contract_sources_hash
  } | shasum -a 256 | awk '{print $1}'
}

lowercase() {
  printf '%s' "$1" | tr 'A-F' 'a-f'
}

# The governance contract is live and executes in the certificate registry the record names.
contract_compatible() {
  local governance="$1"
  local registry="$2"
  [ "$(cast code "$governance" --rpc-url http://127.0.0.1:8545 2>/dev/null || echo 0x)" != "0x" ] || return 1
  [ "$(lowercase "$(cast call "$governance" 'certificateRegistry()(address)' --rpc-url http://127.0.0.1:8545 2>/dev/null)")" = "$(lowercase "$registry")" ]
}

deployment_matches_sources() {
  local governance=""
  local registry=""
  local recorded_hash=""
  governance="$(deployment_value .CertificateGovernance.address)"
  registry="$(deployment_value .CertificateRegistry.address)"
  [ -n "$governance" ] && [ -n "$registry" ] || return 1
  contract_compatible "$governance" "$registry" || return 1
  recorded_hash="$(sed -n '1p' "$RUN_DIR/governance-source.sha256" 2>/dev/null || true)"
  [ -n "$recorded_hash" ] && [ "$recorded_hash" = "$(contract_sources_hash)" ]
}

ensure_governance_contract() {
  local governance=""
  local registry=""
  if ! deployment_matches_sources; then
    say "Compiling and deploying the EBSI registries, the certificate registry and its governance"
    # The EBSI registries stay where they are while they are live; the certificate registry
    # and its governance are deployed again, for the development TAO (Networks.sol key 4).
    # forge directly, as the Makefile's build and deploy-ebsi-besu targets do: those need
    # GNU Make 3.82 or newer (.ONESHELL), and macOS ships 3.81.
    (cd "$ROOT/contracts" && forge build && {
      ! scripts/skip-if-deployed.sh besu-ebsi.json http://127.0.0.1:8545 .ebsi.ProxyFactory.contractAddress "" ||
        forge script scripts/DeployEBSI.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
    } && node scripts/export-abi.js)
    (cd "$ROOT/contracts" && GOVERNANCE_TAO_DID="$DEVELOPMENT_TAO_DID" \
      forge script scripts/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast)
    CONTRACT_CHANGED=1
  fi

  governance="$(deployment_value .CertificateGovernance.address)"
  registry="$(deployment_value .CertificateRegistry.address)"
  [ -n "$governance" ] || fail "No CertificateGovernance address in contracts/deployments/besu.json"
  [ -n "$registry" ] || fail "No CertificateRegistry address in contracts/deployments/besu.json"
  set_env_value "$ROOT/infra/.env" "PLR_GOVERNANCE_CONTRACT" "$governance"
  set_env_value "$ROOT/infra/.env" "PLR_CERTIFICATE_REGISTRY" "$registry"
  set_env_value "$ROOT/infra/.env" "PLR_GOVERNANCE_TAO_DID" "$DEVELOPMENT_TAO_DID"
  set_env_value "$ROOT/holder-wallet/.env" "CERTIFICATE_REGISTRY" "$registry"
  printf '%s\n' "$(contract_sources_hash)" > "$RUN_DIR/governance-source.sha256"
  ok "certificate registry: $registry, governance: $governance"
}

http_ok() {
  curl -fsS "$1" >/dev/null 2>&1
}

wait_http() {
  local url="$1"
  local name="$2"
  local tries="${3:-60}"
  local i
  for i in $(seq 1 "$tries"); do
    if http_ok "$url"; then
      ok "$name is ready"
      return 0
    fi
    sleep 2
  done
  fail "$name did not become ready at $url"
}

wait_besu() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -H "content-type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      http://127.0.0.1:8545 | grep -q '"result"'; then
      ok "Besu RPC is ready"
      return 0
    fi
    sleep 2
  done
  fail "Besu RPC did not become ready at http://127.0.0.1:8545"
}

repair_missing_compose_port() {
  local service="$1"
  local published_port="$2"
  local target_port="$3"
  local container_id=""
  local ports=""

  container_id="$(cd "$ROOT/infra" && docker compose -p "$INFRA_PROJECT_NAME" ps -q "$service")"
  [ -n "$container_id" ] || return 0
  ports="$(docker ps --filter "id=$container_id" --format '{{.Ports}}')"
  if ! printf '%s' "$ports" | grep -q "${published_port}->${target_port}/tcp"; then
    warn "$service did not retain its host port after an earlier bind conflict; recreating it"
    (cd "$ROOT/infra" && docker compose -p "$INFRA_PROJECT_NAME" up -d --force-recreate "$service")
  fi
}

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_background() {
  local name="$1"
  local port="$2"
  local dir="$3"
  local session="plr-$name"
  local command_line=""
  local login_shell="${SHELL:-/bin/bash}"
  local node_bin_dir=""
  local quoted=""
  shift 3

  if port_listening "$port"; then
    warn "$name port $port is already in use; leaving the existing process running"
    return 0
  fi

  node_bin_dir="$(dirname "$(command -v node)")"
  say "Starting $name"
  if command -v screen >/dev/null 2>&1; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    for arg in "$@"; do
      printf -v quoted '%q' "$arg"
      command_line="$command_line $quoted"
    done
    printf '%s\n' "$session" > "$PID_DIR/${name}.session"
    screen -dmS "$session" "$login_shell" -lc "export PATH=$(printf '%q' "$node_bin_dir"):\$PATH; cd $(printf '%q' "$dir") && exec$command_line > $(printf '%q' "$LOG_DIR/${name}.log") 2>&1 < /dev/null"
  else
    (
      cd "$dir"
      nohup "$@" > "$LOG_DIR/${name}.log" 2>&1 < /dev/null &
      printf '%s\n' "$!" > "$PID_DIR/${name}.pid"
    )
  fi
  ok "$name started; log: $LOG_DIR/${name}.log"
}

load_node_env
say "Checking tools"
for command in docker curl lsof npm yarn shasum jq forge cast; do
  need_cmd "$command"
done
check_node_version
ensure_docker
check_public_port 8000
check_public_port 8090
ok "Node $(node --version), Docker and required tools are available"

LAN_IP="${PLR_PUBLIC_HOST:-$(detect_ip)}"
say "Configuring shared device host: $LAN_IP"
ensure_env_file "$ROOT/infra/.env" "$ROOT/infra/.env.example"
ensure_env_file "$ROOT/holder-wallet/.env" "$ROOT/holder-wallet/.env.example"
set_env_value "$ROOT/infra/.env" "PLR_PUBLIC_HOST" "$LAN_IP"
set_env_value "$ROOT/infra/.env" "PLR_BIND_ADDRESS" "${PLR_BIND_ADDRESS:-0.0.0.0}"
set_env_value "$ROOT/holder-wallet/.env" "NODE_IP" "http://$LAN_IP:8545"
set_env_value "$ROOT/holder-wallet/.env" "LINK_URL" "http://$LAN_IP:8000"
set_env_value "$ROOT/holder-wallet/.env" "CRYPTO_SERVICE_URL" "http://$LAN_IP:8000"
set_env_value "$ROOT/holder-wallet/.env" "BACKOFFICE_URL" "http://$LAN_IP:8000"
set_env_value "$ROOT/holder-wallet/.env" "EBSI_URL" "http://$LAN_IP:8090"
set_env_value "$ROOT/holder-wallet/.env" "LEDGER_CHAIN_ID" "1337"
# The back-office signs through EBSI's Ledger API (the development EBSI service), not the node.
set_env_value "$ROOT/infra/.env" "PLR_LEDGER_RPC_URL" "http://ebsi-mock:8090/v1/ledger"
set_env_value "$ROOT/holder-wallet/.env" "EBSI_SUPPORT_OFFICE_DID" "did:ebsi:zSupport"
set_ios_ats_host "$LAN_IP"
ok "server and Wallet URLs use $LAN_IP"

say "Checking dependencies"
[ -d "$ROOT/contracts/dependencies" ] || (cd "$ROOT/contracts" && forge soldeer install)
ensure_npm_dependencies "back-office" "$ROOT/back-office"
ensure_yarn_dependencies "holder-wallet" "$ROOT/holder-wallet"
if [ "${SKIP_PODS:-0}" != "1" ] && { [ ! -d "$ROOT/holder-wallet/ios/Pods" ] || \
  ! cmp -s "$ROOT/holder-wallet/ios/Podfile.lock" "$ROOT/holder-wallet/ios/Pods/Manifest.lock"; }; then
  if command -v pod >/dev/null 2>&1; then
    say "Installing iOS Pods"
    (cd "$ROOT/holder-wallet/ios" && pod install)
  else
    warn "CocoaPods is missing; install it before building for iPhone"
  fi
fi
ok "dependencies are present"

say "Starting Besu"
(cd "$ROOT/infra/besu/besu-qbft-network" && docker compose up -d)
wait_besu
ensure_governance_contract

say "Starting TypeScript back-office, worker and development services"
RUNTIME_HASH="$(runtime_sources_hash)"
PREVIOUS_RUNTIME_HASH="$(sed -n '1p' "$RUN_DIR/runtime-source.sha256" 2>/dev/null || true)"
if [ "${REBUILD:-auto}" = "1" ] || [ "$CONTRACT_CHANGED" = "1" ] || \
  { [ "${REBUILD:-auto}" != "0" ] && { ! docker image inspect atest-back-office:local >/dev/null 2>&1 || \
    [ "$PREVIOUS_RUNTIME_HASH" != "$RUNTIME_HASH" ]; }; }; then
  (cd "$ROOT/infra" && docker compose -p "$INFRA_PROJECT_NAME" up -d --build)
else
  (cd "$ROOT/infra" && docker compose -p "$INFRA_PROJECT_NAME" up -d)
fi
printf '%s\n' "$RUNTIME_HASH" > "$RUN_DIR/runtime-source.sha256"
repair_missing_compose_port ebsi-mock 8090 8090
repair_missing_compose_port backend 8000 8088
wait_http "http://127.0.0.1:8000/health/ready" "Back-office API" 120
wait_http "http://127.0.0.1:8090/health" "Development registries" 60

say "Bootstrapping the local installation"
(cd "$ROOT/infra" && env COMPOSE_PROJECT_NAME="$INFRA_PROJECT_NAME" ./bootstrap.sh)
wait_http "http://127.0.0.1:8000/health/ready" "Back-office API" 60
wait_http "http://127.0.0.1:8000/" "Operator website" 30

if [ "${NO_METRO:-0}" != "1" ]; then
  start_background "metro" "8081" "$ROOT/holder-wallet" yarn start --lan
  wait_http "http://127.0.0.1:8081/status" "Metro" 60
fi

if [ "$DEV_WEB_ENABLED" = "1" ]; then
  start_background "web-dev" "5173" "$ROOT/back-office" npm run dev -- --host 0.0.0.0
  wait_http "http://127.0.0.1:5173/" "Vite development website" 60
fi

say "Ready"
printf "Website and API: http://%s:8000/\n" "$LAN_IP"
printf "Registries:      http://%s:8090/\n" "$LAN_IP"
printf "Besu RPC:       http://%s:8545/\n" "$LAN_IP"
if [ "${NO_METRO:-0}" != "1" ]; then
  printf "Metro:          http://%s:8081/status\n" "$LAN_IP"
fi
if [ "$DEV_WEB_ENABLED" = "1" ]; then
  printf "Vite dev site:  http://%s:5173/\n" "$LAN_IP"
fi
printf "\nRun on a connected phone:\n"
printf "  iPhone:  cd %s/holder-wallet && yarn ios --device --no-bundler\n" "$ROOT"
printf "  Android: cd %s/holder-wallet && yarn android --no-bundler\n" "$ROOT"
printf "  Xcode:   %s/holder-wallet/ios/atestwallet.xcworkspace\n" "$ROOT"
printf "\nMetro log: %s/metro.log\n" "$LOG_DIR"
