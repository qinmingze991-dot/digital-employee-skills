import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const NAME = 'digital-employee-connect';
export const SCHEMA = 'digital-employee-skill/1';
export const PAYLOAD = Object.freeze([
  'SKILL.md', 'agents/openai.yaml', 'scripts/core.mjs',
  'references/qoder.md', 'references/kimi.md',
]);
const RECEIPT = '.digital-employee-install.json';
const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

export class SkillError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireThat(value, code) { if (!value) throw new SkillError(code); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
async function statMaybe(candidate) {
  try { return await fs.lstat(candidate); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function safeAncestors(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const pieces = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const piece of pieces) {
    current = path.join(current, piece);
    const stat = await statMaybe(current);
    if (!stat) continue;
    requireThat(!stat.isSymbolicLink(), 'LINK_PATH_REFUSED');
    requireThat(stat.isDirectory(), 'NON_DIRECTORY_ANCESTOR');
  }
}
async function safeMkdir(directory) {
  await safeAncestors(directory);
  await fs.mkdir(directory, { recursive: true });
  await safeAncestors(directory);
}
async function snapshotTree(directory) {
  const found = new Map();
  const known = new Set([...PAYLOAD, 'manifest.json', RECEIPT]);
  const rootStat = await statMaybe(directory);
  requireThat(rootStat?.isDirectory() && !rootStat.isSymbolicLink(), 'UNSAFE_DIRECTORY');
  async function walk(current, relative = '') {
    for (const name of await fs.readdir(current)) {
      const absolute = path.join(current, name);
      const item = relative ? relative + '/' + name : name;
      const stat = await fs.lstat(absolute);
      requireThat(!stat.isSymbolicLink(), 'LINK_PATH_REFUSED');
      if (stat.isDirectory()) {
        requireThat([...known].some(file => file.startsWith(item + '/')), 'UNTRACKED_FILES');
        await walk(absolute, item);
      }
      else {
        requireThat(known.has(item), 'UNTRACKED_FILES');
        requireThat(stat.isFile() && stat.nlink === 1, 'NON_REGULAR_OR_LINKED_FILE');
        requireThat(stat.size <= 512 * 1024, 'FILE_TOO_LARGE');
        found.set(item, await fs.readFile(absolute));
      }
    }
  }
  await walk(directory);
  return found;
}
function parseManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { throw new SkillError('INVALID_MANIFEST'); }
  requireThat(exactKeys(manifest, ['schema', 'name', 'version', 'files']), 'INVALID_MANIFEST');
  requireThat(manifest.schema === SCHEMA && manifest.name === NAME
    && typeof manifest.version === 'string' && manifest.version.length <= 80 && VERSION.test(manifest.version), 'INVALID_MANIFEST');
  requireThat(Array.isArray(manifest.files) && manifest.files.length === PAYLOAD.length, 'INVALID_MANIFEST');
  const expected = new Set(PAYLOAD);
  for (const item of manifest.files) {
    requireThat(exactKeys(item, ['path', 'sha256']) && expected.delete(item.path)
      && typeof item.sha256 === 'string' && HASH.test(item.sha256), 'INVALID_MANIFEST');
  }
  requireThat(expected.size === 0, 'INVALID_MANIFEST');
  return manifest;
}
function verifySnapshot(files, { receiptAllowed = false } = {}) {
  requireThat(files.has('manifest.json'), 'MANIFEST_MISSING');
  const manifestBytes = files.get('manifest.json');
  const manifest = parseManifest(manifestBytes);
  const allowed = new Set([...PAYLOAD, 'manifest.json', ...(receiptAllowed ? [RECEIPT] : [])]);
  requireThat([...files.keys()].every(name => allowed.has(name)), 'UNTRACKED_FILES');
  for (const item of manifest.files) {
    requireThat(files.has(item.path) && digest(files.get(item.path)) === item.sha256, 'INTEGRITY_MISMATCH');
  }
  return { manifest, manifestSha256: digest(manifestBytes), files };
}
export function context(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const roaming = options.roaming ?? process.env.APPDATA;
  const local = options.local ?? process.env.LOCALAPPDATA;
  requireThat(platform === 'win32', 'UNSUPPORTED_OS');
  requireThat([home, roaming, local].every(value => typeof value === 'string' && path.isAbsolute(value)), 'WINDOWS_PROFILE_UNAVAILABLE');
  return {
    platform, home: path.resolve(home), roaming: path.resolve(roaming), local: path.resolve(local),
    source: path.resolve(options.source ?? SOURCE),
    state: path.join(path.resolve(local), 'DigitalEmployeeSkill'),
  };
}
function hostRoot(ctx, host) {
  requireThat(['qoder', 'kimi'].includes(host), 'UNSUPPORTED_HOST');
  return host === 'qoder'
    ? path.join(ctx.home, '.qoder', 'skills')
    : path.join(ctx.roaming, 'kimi-desktop', 'daimon-share', 'daimon', 'skills');
}
function targetPath(ctx, host) {
  const root = hostRoot(ctx, host);
  const target = path.resolve(root, NAME);
  requireThat(inside(root, target) && path.basename(target) === NAME, 'TARGET_BOUNDARY_FAILED');
  return target;
}
async function checkHostRoot(ctx, host) {
  const root = hostRoot(ctx, host);
  await safeAncestors(root);
  const indicator = host === 'qoder' ? path.join(ctx.home, '.qoder') : root;
  const stat = await statMaybe(indicator);
  requireThat(stat?.isDirectory() && !stat.isSymbolicLink(), 'HOST_DIRECTORY_NOT_FOUND');
  return root;
}
export async function readSource(ctx) {
  const source = verifySnapshot(await snapshotTree(ctx.source), { receiptAllowed: true });
  return { ...source, files: new Map([...source.files].filter(([name]) => name !== RECEIPT)) };
}
export async function detectHost(ctx, host) {
  const root = hostRoot(ctx, host);
  await safeAncestors(root);
  const indicator = host === 'qoder' ? path.join(ctx.home, '.qoder') : root;
  const stat = await statMaybe(indicator);
  return {
    host, hostDirectoryDetected: Boolean(stat?.isDirectory() && !stat.isSymbolicLink()),
    target: targetPath(ctx, host), pathSource: host === 'qoder' ? 'QODER_IDE_DOCUMENTED_USER_DIRECTORY' : 'KIMI_WORK_WINDOWS_DIRECTORY',
    nativeActivation: 'NOT_VERIFIED', deviceBinding: 'NOT_AVAILABLE',
  };
}
async function inspectTarget(ctx, host) {
  const target = targetPath(ctx, host);
  await safeAncestors(path.dirname(target));
  const stat = await statMaybe(target);
  if (!stat) return null;
  requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'TARGET_CONFLICT');
  const installed = verifySnapshot(await snapshotTree(target), { receiptAllowed: true });
  let receipt = null;
  if (installed.files.has(RECEIPT)) {
    try { receipt = JSON.parse(installed.files.get(RECEIPT).toString('utf8')); }
    catch { throw new SkillError('INVALID_RECEIPT'); }
    requireThat(exactKeys(receipt, ['schema', 'name', 'host', 'version', 'manifestSha256', 'installedAt']), 'INVALID_RECEIPT');
    requireThat(receipt.schema === SCHEMA && receipt.name === NAME && receipt.host === host
      && receipt.version === installed.manifest.version && receipt.manifestSha256 === installed.manifestSha256
      && typeof receipt.installedAt === 'string' && Number.isFinite(Date.parse(receipt.installedAt)), 'INVALID_RECEIPT');
  }
  return { target, ...installed, receipt };
}
export async function verifyInstall(ctx, host) {
  const installed = await inspectTarget(ctx, host);
  requireThat(installed, 'NOT_INSTALLED');
  return {
    status: 'FILES_VERIFIED', name: NAME, host, version: installed.manifest.version,
    managedByInstaller: Boolean(installed.receipt), nativeActivation: 'NOT_VERIFIED', deviceBinding: 'NOT_AVAILABLE',
  };
}
export async function planInstall(ctx, host) {
  const source = await readSource(ctx);
  const detection = await detectHost(ctx, host);
  requireThat(detection.hostDirectoryDetected, 'HOST_DIRECTORY_NOT_FOUND');
  const installed = await inspectTarget(ctx, host);
  return {
    status: 'PLAN_ONLY', ...detection, sourceVersion: source.manifest.version,
    installedVersion: installed?.manifest.version ?? null,
    replaceRequired: Boolean(installed && installed.manifestSha256 !== source.manifestSha256),
    writes: [detection.target, path.join(ctx.state, host)],
  };
}
async function withLock(ctx, host, action) {
  const state = path.join(ctx.state, host);
  requireThat(inside(ctx.local, state), 'STATE_BOUNDARY_FAILED');
  await safeMkdir(state);
  const lockPath = path.join(state, 'installer.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new SkillError('INSTALLER_BUSY'); throw error; }
  try { return await action(state); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}
export async function installSkill(ctx, host, { replace = false } = {}) {
  const source = await readSource(ctx);
  const root = await checkHostRoot(ctx, host);
  const target = targetPath(ctx, host);
  return withLock(ctx, host, async state => {
    const installed = await inspectTarget(ctx, host);
    if (installed?.manifestSha256 === source.manifestSha256) {
      return { ...(await verifyInstall(ctx, host)), status: 'ALREADY_PRESENT' };
    }
    if (installed) {
      requireThat(replace, 'REPLACE_CONFIRMATION_REQUIRED');
      requireThat(installed.receipt, 'UNMANAGED_INSTALLATION');
      requireThat(installed.manifest.version !== source.manifest.version, 'SAME_VERSION_DIFFERENT_CONTENT');
    }
    await safeMkdir(root);
    const stageRoot = path.join(state, 'staging');
    await safeMkdir(stageRoot);
    const stage = await fs.mkdtemp(path.join(stageRoot, NAME + '-'));
    requireThat(inside(state, stage), 'STATE_BOUNDARY_FAILED');
    for (const [relative, bytes] of source.files) {
      const destination = path.resolve(stage, relative);
      requireThat(inside(stage, destination), 'TARGET_BOUNDARY_FAILED');
      await safeMkdir(path.dirname(destination));
      await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    }
    const receipt = {
      schema: SCHEMA, name: NAME, host, version: source.manifest.version,
      manifestSha256: source.manifestSha256, installedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(stage, RECEIPT), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    verifySnapshot(await snapshotTree(stage), { receiptAllowed: true });
    let backup = null;
    if (installed) {
      const backupRoot = path.join(state, 'backups');
      await safeMkdir(backupRoot);
      backup = path.join(backupRoot, installed.manifest.version + '-' + randomUUID());
      requireThat(inside(state, backup) && !(await statMaybe(backup)), 'STATE_BOUNDARY_FAILED');
      await inspectTarget(ctx, host);
      await fs.rename(target, backup);
    }
    try {
      await safeAncestors(path.dirname(target));
      requireThat(!(await statMaybe(target)), 'TARGET_CONFLICT');
      await fs.rename(stage, target);
      await verifyInstall(ctx, host);
    } catch (error) {
      // Keep staging/backup evidence. Restore only into an absent, guarded target.
      if (backup && !(await statMaybe(target))) {
        await safeAncestors(path.dirname(target));
        await fs.rename(backup, target);
      }
      throw error;
    }
    return {
      status: 'FILES_INSTALLED', name: NAME, host, version: source.manifest.version,
      target, backup, nativeActivation: 'NOT_VERIFIED', deviceBinding: 'NOT_AVAILABLE',
    };
  });
}
export async function uninstallSkill(ctx, host, { confirm } = {}) {
  requireThat(confirm === NAME, 'UNINSTALL_CONFIRMATION_REQUIRED');
  const target = targetPath(ctx, host);
  await checkHostRoot(ctx, host);
  return withLock(ctx, host, async state => {
    const installed = await inspectTarget(ctx, host);
    requireThat(installed, 'NOT_INSTALLED');
    requireThat(installed.receipt, 'UNMANAGED_INSTALLATION');
    const backupRoot = path.join(state, 'backups');
    await safeMkdir(backupRoot);
    const backup = path.join(backupRoot, 'uninstalled-' + installed.manifest.version + '-' + randomUUID());
    requireThat(inside(state, backup) && !(await statMaybe(backup)), 'STATE_BOUNDARY_FAILED');
    await inspectTarget(ctx, host);
    await fs.rename(target, backup);
    return { status: 'FILES_UNINSTALLED', name: NAME, host, backup, nativeRemoval: 'NOT_VERIFIED' };
  });
}
export async function doctor(ctx, host) {
  const source = await readSource(ctx);
  const detection = await detectHost(ctx, host);
  let installed = null;
  if (await statMaybe(detection.target)) installed = await verifyInstall(ctx, host);
  return {
    status: 'LOCAL_CHECK_COMPLETE', version: source.manifest.version, nodeVersion: process.versions.node,
    ...detection, installed, networkRequests: 0, platform: 'NOT_CONTACTED',
    employeeExecution: 'NOT_AVAILABLE', storageContainsCredentials: false,
  };
}
function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = {};
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index];
    requireThat(['--host', '--replace', '--confirm'].includes(key) && !Object.hasOwn(options, key), 'INVALID_ARGUMENTS');
    if (key === '--replace') options[key] = true;
    else {
      requireThat(typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), 'INVALID_ARGUMENTS');
      options[key] = argv[++index];
    }
  }
  return { command, options };
}
async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (['help', '--help'].includes(command)) {
    requireThat(Object.keys(options).length === 0, 'INVALID_ARGUMENTS');
    return { name: NAME, commands: ['info', 'detect', 'plan', 'install', 'verify', 'doctor', 'uninstall'],
      usage: 'node scripts/core.mjs COMMAND --host qoder|kimi',
      update: 'install --host qoder|kimi --replace',
      remove: 'uninstall --host qoder|kimi --confirm digital-employee-connect',
      deviceBinding: 'NOT_AVAILABLE' };
  }
  requireThat(Number(process.versions.node.split('.')[0]) >= 22, 'NODE_22_REQUIRED');
  if (command === 'info') {
    requireThat(Object.keys(options).length === 0, 'INVALID_ARGUMENTS');
    const source = await readSource({ source: SOURCE });
    return { name: NAME, version: source.manifest.version, manifestSha256: source.manifestSha256,
      status: 'SOURCE_VERIFIED', nativeActivation: 'NOT_VERIFIED', deviceBinding: 'NOT_AVAILABLE', employeeExecution: 'NOT_AVAILABLE' };
  }
  if (['bind', 'connect', 'employees', 'run'].includes(command)) throw new SkillError('FEATURE_NOT_AVAILABLE');
  requireThat(['detect', 'plan', 'install', 'verify', 'doctor', 'uninstall'].includes(command), 'UNKNOWN_COMMAND');
  const validKeys = command === 'install' ? ['--host', '--replace']
    : command === 'uninstall' ? ['--host', '--confirm'] : ['--host'];
  requireThat(Object.keys(options).every(key => validKeys.includes(key)), 'INVALID_ARGUMENTS');
  const ctx = context();
  const host = options['--host'];
  if (command === 'detect') return detectHost(ctx, host);
  if (command === 'plan') return planInstall(ctx, host);
  if (command === 'verify') return verifyInstall(ctx, host);
  if (command === 'doctor') return doctor(ctx, host);
  if (command === 'install') return installSkill(ctx, host, { replace: options['--replace'] === true });
  return uninstallSkill(ctx, host, { confirm: options['--confirm'] });
}
const invokedFile = process.argv[1] ? await fs.realpath(path.resolve(process.argv[1])).catch(() => null) : null;
if (invokedFile && path.relative(invokedFile, fileURLToPath(import.meta.url)) === '') {
  main(process.argv.slice(2)).then(data => {
    console.log(JSON.stringify({ ok: true, data }, null, 2));
  }).catch(error => {
    // Never echo arbitrary arguments, configuration or exception messages.
    console.error(JSON.stringify({ ok: false, error: { code: error instanceof SkillError ? error.code : 'LOCAL_OPERATION_FAILED' } }));
    process.exitCode = 1;
  });
}
