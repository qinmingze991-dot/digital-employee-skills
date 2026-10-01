import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NAME, SCHEMA, PAYLOAD } from '../skills/digital-employee-connect/scripts/core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'skills', NAME);
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = { schema: SCHEMA, name: NAME, version: pkg.version, files: [] };
for (const relative of PAYLOAD) {
  const bytes = await fs.readFile(path.join(source, relative));
  manifest.files.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifest refreshed for ' + pkg.version);
