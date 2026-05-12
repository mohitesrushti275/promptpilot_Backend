#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json is missing in ${ROOT}. Add it from the repo before installing on production." >&2
  exit 1
fi

rm -rf node_modules
npm ci
node scripts/verify-sharp.mjs
echo "Production dependencies installed successfully."
