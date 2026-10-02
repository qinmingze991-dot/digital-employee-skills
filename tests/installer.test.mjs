import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NAME, PAYLOAD, context, detectHost, readSource, planInstall, installSkill, verifyInstall, uninstallSkill, doctor } from '../skills/digital-employee-connect/scripts/core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(repo, 'skills', NAME);
const testRoot = path.resolve(process.env.DE_SKILL_TEST_ROOT ?? path.join(os.tmpdir(), 'digital-employee-skill-tests'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function fixture({ kimi = true } = {}) {
  await fs.mkdir(testRoot, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(path.join(testRoot, 'case-')));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  for (const relative of [...PAYLOAD, 'manifest.json']) {
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await fs.copyFile(path.join(original, relative), path.join(source, relative));
  }
  const home = path.join(root, 'home'), roaming = path.join(root, 'roaming'), local = path.join(root, 'local');
  await fs.mkdir(path.join(home, '.qoder', 'skills', 'other-skill'), { recursive: true });
  await fs.mkdir(roaming); await fs.mkdir(local);
  const other = path.join(home, '.qoder', 'skills', 'other-skill', 'sentinel.txt');
  await fs.writeFile(other, 'unrelated user content');
  if (kimi) await fs.mkdir(path.join(roaming, 'kimi-desktop', 'daimon-share', 'daimon', 'skills'), { recursive: true });
  return { root, source, other, ctx: context({ platform: 'win32', home, roaming, local, source }) };
}
async function newVersion(f, version = '0.1.1-preview.2') {
  const manifestPath = path.join(f.source, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const oldVersion = manifest.version;
  const skillPath = path.join(f.source, 'SKILL.md');
  const text = await fs.readFile(skillPath, 'utf8');
  await fs.writeFile(skillPath, text.replaceAll(oldVersion, version));
  manifest.version = version;
  for (const item of manifest.files) item.sha256 = hash(await fs.readFile(path.join(f.source, item.path)));
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
function rejectsCode(action, code) { return assert.rejects(action, error => error.code === code); }

test('plan is read-only and new install preserves unrelated content', async () => {
  const f = await fixture();
  const planned = await planInstall(f.ctx, 'qoder');
  assert.equal(planned.status, 'PLAN_ONLY');
  assert.equal(await exists(f.ctx.state), false);
  const result = await installSkill(f.ctx, 'qoder');
  assert.equal(result.status, 'FILES_INSTALLED');
  assert.equal(result.nativeActivation, 'NOT_VERIFIED');
  const verified = await verifyInstall(f.ctx, 'qoder');
  assert.equal(verified.managedByInstaller, true);
  assert.equal(verified.deviceBinding, 'NOT_CHECKED');
  assert.equal(await fs.readFile(f.other, 'utf8'), 'unrelated user content');
});

test('repeat identical install does not replace receipt or create backup', async () => {
  const f = await fixture();
  const first = await installSkill(f.ctx, 'qoder');
  const receiptPath = path.join(first.target, '.digital-employee-install.json');
  const before = await fs.readFile(receiptPath);
  const second = await installSkill(f.ctx, 'qoder');
  assert.equal(second.status, 'ALREADY_PRESENT');
  assert.deepEqual(await fs.readFile(receiptPath), before);
  assert.equal(await exists(path.join(f.ctx.state, 'qoder', 'backups')), false);
});

test('installed helper info works with its installation receipt present', async () => {
  const f = await fixture();
  const installed = await installSkill(f.ctx, 'qoder');
  const child = spawnSync(process.execPath, [path.join(installed.target, 'scripts', 'core.mjs'), 'info'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const data = JSON.parse(child.stdout).data;
  assert.equal(data.status, 'SOURCE_VERIFIED');
  assert.equal(data.nativeActivation, 'NOT_VERIFIED');
});

test('update needs confirmation and retains byte-exact old version', async () => {
  const f = await fixture();
  const first = await installSkill(f.ctx, 'qoder');
  const before = await fs.readFile(path.join(first.target, 'SKILL.md'));
  await newVersion(f);
  await rejectsCode(() => installSkill(f.ctx, 'qoder'), 'REPLACE_CONFIRMATION_REQUIRED');
  assert.deepEqual(await fs.readFile(path.join(first.target, 'SKILL.md')), before);
  const updated = await installSkill(f.ctx, 'qoder', { replace: true });
  assert.equal(updated.version, '0.1.1-preview.2');
  assert.deepEqual(await fs.readFile(path.join(updated.backup, 'SKILL.md')), before);
  assert.equal((await verifyInstall(f.ctx, 'qoder')).version, '0.1.1-preview.2');
  assert.equal(await fs.readFile(f.other, 'utf8'), 'unrelated user content');
});

test('same version with different content refuses replacement', async () => {
  const f = await fixture();
  await installSkill(f.ctx, 'qoder');
  await fs.appendFile(path.join(f.source, 'SKILL.md'), '\nEdited without version bump.\n');
  await newVersion(f, '0.1.1-preview.1');
  await rejectsCode(() => installSkill(f.ctx, 'qoder', { replace: true }), 'SAME_VERSION_DIFFERENT_CONTENT');
});

test('tampered installed file is preserved, not overwritten or uninstalled', async () => {
  const f = await fixture();
  const installed = await installSkill(f.ctx, 'qoder');
  const skillPath = path.join(installed.target, 'SKILL.md');
  await fs.appendFile(skillPath, '\nUser notes\n');
  const before = await fs.readFile(skillPath);
  await newVersion(f);
  await rejectsCode(() => installSkill(f.ctx, 'qoder', { replace: true }), 'INTEGRITY_MISMATCH');
  await rejectsCode(() => uninstallSkill(f.ctx, 'qoder', { confirm: NAME }), 'INTEGRITY_MISMATCH');
  assert.deepEqual(await fs.readFile(skillPath), before);
});

test('untracked data prevents uninstall and stays intact', async () => {
  const f = await fixture();
  const installed = await installSkill(f.ctx, 'qoder');
  const note = path.join(installed.target, 'personal-note.txt');
  await fs.writeFile(note, 'keep this file');
  await rejectsCode(() => uninstallSkill(f.ctx, 'qoder', { confirm: NAME }), 'UNTRACKED_FILES');
  assert.equal(await fs.readFile(note, 'utf8'), 'keep this file');
});

test('uninstall requires exact name and moves only owned installation to backup', async () => {
  const f = await fixture();
  const installed = await installSkill(f.ctx, 'qoder');
  await rejectsCode(() => uninstallSkill(f.ctx, 'qoder'), 'UNINSTALL_CONFIRMATION_REQUIRED');
  const result = await uninstallSkill(f.ctx, 'qoder', { confirm: NAME });
  assert.equal(result.status, 'FILES_UNINSTALLED');
  assert.equal(await exists(installed.target), false);
  assert.equal(await exists(path.join(result.backup, 'SKILL.md')), true);
  assert.equal(await fs.readFile(f.other, 'utf8'), 'unrelated user content');
});

test('native imported payload can be verified but cannot be taken over', async () => {
  const f = await fixture();
  const target = (await detectHost(f.ctx, 'kimi')).target;
  await fs.cp(f.source, target, { recursive: true });
  assert.equal((await verifyInstall(f.ctx, 'kimi')).managedByInstaller, false);
  await newVersion(f);
  await rejectsCode(() => installSkill(f.ctx, 'kimi', { replace: true }), 'UNMANAGED_INSTALLATION');
  await rejectsCode(() => uninstallSkill(f.ctx, 'kimi', { confirm: NAME }), 'UNMANAGED_INSTALLATION');
  assert.equal(await exists(target), true);
});

test('foreign directory refuses install without altering its files', async () => {
  const f = await fixture();
  const target = (await detectHost(f.ctx, 'qoder')).target;
  await fs.mkdir(target);
  const foreign = path.join(target, 'SKILL.md');
  await fs.writeFile(foreign, 'existing independent user Skill');
  await rejectsCode(() => installSkill(f.ctx, 'qoder', { replace: true }), 'MANIFEST_MISSING');
  assert.equal(await fs.readFile(foreign, 'utf8'), 'existing independent user Skill');
});

test('missing Kimi Work root does not fall back to Kimi CLI or invent an install', async () => {
  const f = await fixture({ kimi: false });
  const cli = path.join(f.ctx.home, '.kimi', 'skills');
  await fs.mkdir(cli, { recursive: true });
  assert.equal((await detectHost(f.ctx, 'kimi')).hostDirectoryDetected, false);
  await rejectsCode(() => installSkill(f.ctx, 'kimi'), 'HOST_DIRECTORY_NOT_FOUND');
  assert.equal(await exists(path.join(cli, NAME)), false);
  assert.equal(await exists(f.ctx.state), false);
});

test('target directory junction is refused and outside content remains untouched', async () => {
  const f = await fixture();
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel.txt'), 'outside');
  const target = (await detectHost(f.ctx, 'qoder')).target;
  await fs.symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsCode(() => installSkill(f.ctx, 'qoder', { replace: true }), 'TARGET_CONFLICT');
  assert.equal(await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside');
});

test('junction in a parent path is refused before any state write', async () => {
  const f = await fixture();
  const home = path.join(f.root, 'alternative-home');
  await fs.mkdir(home);
  await fs.symlink(path.join(f.ctx.home, '.qoder'), path.join(home, '.qoder'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = context({ ...f.ctx, home });
  await rejectsCode(() => installSkill(linked, 'qoder'), 'LINK_PATH_REFUSED');
  assert.equal(await exists(f.ctx.state), false);
});

test('source hardlinks are refused before writing an installation', async () => {
  const f = await fixture();
  const file = path.join(f.source, 'SKILL.md');
  await fs.link(file, path.join(f.root, 'linked-copy.md'));
  await rejectsCode(() => installSkill(f.ctx, 'qoder'), 'NON_REGULAR_OR_LINKED_FILE');
  assert.equal(await exists(f.ctx.state), false);
});

test('manifest path escape is refused without accessing destination', async () => {
  const f = await fixture();
  const manifestPath = path.join(f.source, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.files[0].path = '../../outside';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await rejectsCode(() => readSource(f.ctx), 'INVALID_MANIFEST');
  assert.equal(await exists(f.ctx.state), false);
});

test('receipt for another host cannot authorize removal', async () => {
  const f = await fixture();
  const installed = await installSkill(f.ctx, 'qoder');
  const receiptPath = path.join(installed.target, '.digital-employee-install.json');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  receipt.host = 'kimi';
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await rejectsCode(() => uninstallSkill(f.ctx, 'qoder', { confirm: NAME }), 'INVALID_RECEIPT');
  assert.equal(await exists(installed.target), true);
});

test('Qoder update preserves separate Kimi installation', async () => {
  const f = await fixture();
  await installSkill(f.ctx, 'qoder');
  const kimi = await installSkill(f.ctx, 'kimi');
  const before = await fs.readFile(path.join(kimi.target, 'SKILL.md'));
  await newVersion(f);
  await installSkill(f.ctx, 'qoder', { replace: true });
  assert.deepEqual(await fs.readFile(path.join(kimi.target, 'SKILL.md')), before);
  assert.equal((await verifyInstall(f.ctx, 'kimi')).version, '0.1.1-preview.1');
});

test('local doctor does not claim activation, account binding or network access', async () => {
  const f = await fixture();
  await installSkill(f.ctx, 'kimi');
  const data = await doctor(f.ctx, 'kimi');
  assert.equal(data.nativeActivation, 'NOT_VERIFIED');
  assert.equal(data.deviceBinding, 'NOT_CHECKED');
  assert.equal(data.employeeExecution, 'NOT_CHECKED');
  assert.equal(data.networkRequests, 0);
  assert.equal(data.platform, 'NOT_CONTACTED');
});

test('CLI refuses binding and never echoes a supplied unsupported secret argument', () => {
  const core = path.join(original, 'scripts', 'core.mjs');
  const bind = spawnSync(process.execPath, [core, 'bind', '--host', 'kimi'], { encoding: 'utf8' });
  assert.equal(bind.status, 1);
  assert.equal(JSON.parse(bind.stderr).error.code, 'FEATURE_NOT_AVAILABLE');
  const fake = 'test-value-that-must-not-be-echoed';
  const rejected = spawnSync(process.execPath, [core, 'install', '--host', 'qoder', '--token', fake], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.equal((rejected.stdout + rejected.stderr).includes(fake), false);
  assert.equal(JSON.parse(rejected.stderr).error.code, 'INVALID_ARGUMENTS');
});

test('CLI entrypoint runs when reached through a directory junction', async () => {
  const f = await fixture();
  const alias = path.join(f.root, 'source-alias');
  await fs.symlink(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const child = spawnSync(process.execPath, [path.join(alias, 'scripts', 'core.mjs'), 'info'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).data.status, 'SOURCE_VERIFIED');
});
