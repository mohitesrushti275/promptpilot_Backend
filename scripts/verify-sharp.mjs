import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharpPkg = path.join(root, 'node_modules/sharp/package.json');

try {
  await access(sharpPkg);
} catch {
  console.error(`sharp is not installed (${sharpPkg} missing).

On the server (same path where you run node server.js):
  bash scripts/install-production.sh
  or: rm -rf node_modules && npm ci

Deploy package.json and package-lock.json; run npm ci on Linux — do not upload node_modules from another OS.
Do not use npm install --omit=optional; sharp needs optional platform packages (@img/sharp-linux-* / linuxmusl).

If native addons are forbidden on this host, you must change the app to avoid sharp (e.g. alternate image handling), not fix this with config alone.`);
  process.exit(1);
}

try {
  await import('sharp');
} catch (e) {
  console.error('sharp is present but failed to load:', e.message);
  process.exit(1);
}
