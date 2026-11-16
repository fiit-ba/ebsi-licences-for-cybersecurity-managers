#!/usr/bin/env bash
# Ordinary idempotent local setup; implementation and checks live in TypeScript.
set -euo pipefail
cd "$(dirname "$0")"
exec node ../back-office/scripts/bootstrap-development.ts "$@"
