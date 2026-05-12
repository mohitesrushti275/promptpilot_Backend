#!/usr/bin/env bash
# If `npm ci` OOMs: add swap, use a host with more RAM, or run install in CI and
# sync node_modules (same OS + libc + CPU). NODE_MEMORY_MB defaults to 4096.
# Screenshot routes need Chromium unless you set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# and later run `npx playwright install chromium` when the server can handle it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json is missing in ${ROOT}. Add it from the repo before installing on production." >&2
  exit 1
fi

# npm ci can OOM on small VPS; give V8 a larger old-space ceiling during install.
: "${NODE_MEMORY_MB:=4096}"
if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${NODE_MEMORY_MB}"
else
  export NODE_OPTIONS="--max-old-space-size=${NODE_MEMORY_MB}"
fi

# Slightly lower peak memory / CPU during extract (override with NPM_CONFIG_MAXSOCKETS if needed).
: "${NPM_CONFIG_MAXSOCKETS:=3}"

rm -rf node_modules
npm ci --no-audit --no-fund
node scripts/verify-sharp.mjs
echo "Production dependencies installed successfully."
if [[ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" == "1" ]]; then
  echo "Playwright browsers were skipped. Run: npx playwright install chromium (needs RAM/disk) before using screenshot APIs." >&2
fi
