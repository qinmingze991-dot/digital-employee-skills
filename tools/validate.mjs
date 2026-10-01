import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME, readSource } from '../skills/digital-employee-connect/scripts/core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'skills', NAME);
const source = await readSource({ source: sourceRoot });
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (source.manifest.version !== pkg.version) throw Error('Package and payload version mismatch');
const skill = (await fs.readFile(path.join(sourceRoot, 'SKILL.md'))).toString('utf8');
if (!skill.startsWith('---\nname: ' + NAME + '\n') || !skill.includes('  version: ' + pkg.version + '\n')) throw Error('Skill metadata mismatch');
const paths = ['README.md', 'skills/' + NAME + '/SKILL.md', 'skills/' + NAME + '/references/qoder.md', 'skills/' + NAME + '/references/kimi.md'];
for (const relative of paths) {
  const file = path.join(root, relative);
  const content = await fs.readFile(file, 'utf8');
  if (content.includes('\uFFFD')) throw Error('Invalid UTF-8 replacement character');
  if (content.split('\n').some(line => /[ \t]+$/.test(line))) throw Error('Trailing whitespace');
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (match[1].startsWith('https://')) continue;
    const resolved = path.resolve(path.dirname(file), match[1]);
    const relation = path.relative(root, resolved);
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw Error('Link escapes repository');
    await fs.access(resolved);
  }
}
console.log(JSON.stringify({ validation: 'PASS', version: pkg.version, payloadFiles: source.manifest.files.length,
  deviceBinding: 'NOT_AVAILABLE', nativeActivation: 'NOT_VERIFIED' }));
