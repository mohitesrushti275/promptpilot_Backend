import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function packageJsonPathForDep(name) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/', 1);
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    return path.join(root, 'node_modules', scope, pkg, 'package.json');
  }
  return path.join(root, 'node_modules', name, 'package.json');
}

const pkgRaw = await readFile(path.join(root, 'package.json'), 'utf8');
const pkg = JSON.parse(pkgRaw);
const deps = pkg.dependencies ?? {};
const missing = [];

for (const name of Object.keys(deps)) {
  const p = packageJsonPathForDep(name);
  try {
    await access(p);
  } catch {
    missing.push(name);
  }
}

if (missing.length) {
  console.error(`Missing or incomplete dependencies (no package.json under node_modules):
  ${missing.join(', ')}

On the server (same directory as server.js):
  npm run install:production
  or: rm -rf node_modules && npm ci

Deploy package.json and package-lock.json; run npm ci on Linux — do not copy node_modules from another OS.
Do not use npm install --omit=optional; sharp needs optional platform packages (@img/sharp-linux-* / linuxmusl).`);
  process.exit(1);
}

try {
  await import('sharp');
} catch (e) {
  console.error('sharp is present but failed to load:', e.message);
  process.exit(1);
}
