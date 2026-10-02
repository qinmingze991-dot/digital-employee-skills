import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SkillError, readSource, context } from './core.mjs';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'digital-employee-client-release/1', BUNDLE = 'digital-employee-client-bundle/1', RECEIPT = 'digital-employee-client-installation/1';
const HASH = /^[a-f0-9]{64}$/, VERSION = /^0\.1\.1(?:-[a-zA-Z0-9.-]+)?$/;
const MAX_ARCHIVE = 512 * 1024 * 1024, MAX_PAYLOAD = 1024 * 1024 * 1024;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function check(value, code) { if (!value) throw new SkillError(code); }
export function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const inside = (root, candidate) => { const item = path.relative(root, candidate); return item !== '' && !path.isAbsolute(item) && item !== '..' && !item.startsWith('..' + path.sep); };
function payloadPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\') && !value.includes(':') && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}
async function regular(file, max = 65536) {
  const stat = await fs.lstat(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= max, 'CLIENT_FILE_UNSAFE');
  return stat;
}
async function json(file) { await regular(file); try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file))); } catch { throw new SkillError('CLIENT_METADATA_INVALID'); } }
async function exists(file) { try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function directories(root, relative = '') {
  await fs.mkdir(root, { recursive: true });
  check((await fs.lstat(root)).isDirectory() && !(await fs.lstat(root)).isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE');
  let current = root;
  for (const piece of relative.split('/').filter(Boolean)) { check(payloadPath(piece), 'CLIENT_DIRECTORY_UNSAFE'); current = path.join(current, piece); await fs.mkdir(current, { recursive: true }); check((await fs.lstat(current)).isDirectory() && !(await fs.lstat(current)).isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE'); }
  return current;
}
export async function readChannel(source = SOURCE) {
  const channel = await json(path.join(source, 'release-channel.json'));
  check(exact(channel, ['schema', 'releaseBase', 'releaseUrl', 'platformOrigin', 'publicKey', 'keyId', 'nodeVersion', 'nodeUrl', 'nodeSha256']), 'RELEASE_CHANNEL_INVALID');
  check(channel.schema === 'digital-employee-release-channel/1' && channel.nodeVersion === '24.18.0'
    && channel.nodeUrl === 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe'
    && channel.nodeSha256 === '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de', 'RELEASE_CHANNEL_INVALID');
  if (channel.publicKey === null || channel.keyId === null) throw new SkillError('RELEASE_NOT_AVAILABLE');
  for (const url of [channel.releaseBase, channel.releaseUrl, channel.platformOrigin]) {
    const parsed = new URL(url); check(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash && !parsed.search, 'RELEASE_CHANNEL_INVALID');
  }
  check(new URL(channel.platformOrigin).origin === channel.platformOrigin && channel.releaseUrl.startsWith(channel.releaseBase + '/'), 'RELEASE_CHANNEL_INVALID');
  check(typeof channel.publicKey === 'string' && channel.publicKey.length <= 256 && channel.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'), 'RELEASE_CHANNEL_INVALID');
  const key = createPublicKey(channel.publicKey);
  check(key.asymmetricKeyType === 'ed25519' && channel.keyId === sha256(key.export({ type: 'spki', format: 'der' })).slice(0, 16), 'RELEASE_CHANNEL_INVALID');
  return channel;
}
export function verifyRelease(value, channel, now = Date.now()) {
  check(exact(value, ['schema', 'version', 'platform', 'nodeVersion', 'bridgeVersion', 'contractVersion', 'deviceProtocol', 'deviceVersion', 'platformOrigin', 'archive', 'bundleManifestSha256', 'publishedAt', 'expiresAt', 'keyId', 'signature']), 'RELEASE_MANIFEST_INVALID');
  check(value.schema === SCHEMA && VERSION.test(value.version) && value.platform === 'win32-x64' && value.nodeVersion === channel.nodeVersion
    && value.bridgeVersion === 'native-bridge/1' && value.contractVersion === '0.1.0-draft.2' && value.deviceProtocol === 'device-binding' && value.deviceVersion === '0.1.1-candidate.1'
    && value.platformOrigin === channel.platformOrigin && HASH.test(value.bundleManifestSha256) && value.keyId === channel.keyId, 'CLIENT_VERSION_INCOMPATIBLE');
  check(utc(value.publishedAt) && utc(value.expiresAt) && Date.parse(value.publishedAt) <= now + 300000 && Date.parse(value.expiresAt) > now
    && Date.parse(value.expiresAt) > Date.parse(value.publishedAt) && Date.parse(value.expiresAt) - Date.parse(value.publishedAt) <= 31 * 86400000, 'RELEASE_EXPIRED');
  check(exact(value.archive, ['url', 'sha256', 'byteLength']) && value.archive.url === channel.releaseBase + '/digital-employee-client-v' + value.version + '-win-x64.zip'
    && HASH.test(value.archive.sha256) && Number.isSafeInteger(value.archive.byteLength) && value.archive.byteLength > 0 && value.archive.byteLength <= MAX_ARCHIVE, 'RELEASE_ARCHIVE_INVALID');
  check(typeof value.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value.signature), 'RELEASE_SIGNATURE_INVALID');
  const { signature, ...unsigned } = value;
  check(verify(null, Buffer.from(canonical(unsigned)), createPublicKey(channel.publicKey), Buffer.from(signature, 'base64')), 'RELEASE_SIGNATURE_INVALID');
  return structuredClone(value);
}
async function responseBytes(response, max) {
  check(response.ok && response.body, 'RELEASE_DOWNLOAD_FAILED');
  const length = response.headers.get('content-length');
  check(length === null || (/^\d+$/.test(length) && Number(length) <= max), 'RELEASE_TOO_LARGE');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.length; check(total <= max, 'RELEASE_TOO_LARGE'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  check(length === null || Number(length) === total, 'RELEASE_DOWNLOAD_FAILED');
  return Buffer.concat(chunks);
}
async function download(url, max, transport) {
  const parsed = new URL(url); check(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash, 'RELEASE_URL_UNTRUSTED');
  let current = parsed;
  for (let count = 0; count < 4; count++) {
    const response = await transport(current.href, { redirect: 'manual', headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(120000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return responseBytes(response, max);
    const location = response.headers.get('location');
    await response.body?.cancel();
    check(parsed.hostname === 'github.com' && location, 'RELEASE_URL_UNTRUSTED');
    const next = new URL(location, current);
    check(next.protocol === 'https:' && !next.username && !next.password && !next.hash
      && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname), 'RELEASE_URL_UNTRUSTED');
    current = next;
  }
  throw new SkillError('RELEASE_DOWNLOAD_FAILED');
}
async function expandArchive(archive, destination, source = SOURCE) {
  await directories(destination);
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(source, 'scripts', 'expand-client.ps1'); await regular(script, 32768);
  const env = { NODE_ENV: 'production' };
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
  await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Archive', archive, '-Destination', destination], { env, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stage = '';
    child.stderr.on('data', chunk => { if (stage.length <= 128) stage += String(chunk); });
    const timer = setTimeout(() => { child.kill(); reject(new SkillError('CLIENT_EXTRACTION_FAILED')); }, 120000);
    child.once('error', () => { clearTimeout(timer); reject(new SkillError('CLIENT_EXTRACTION_FAILED')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolveResult();
      else { const error = new SkillError('CLIENT_EXTRACTION_FAILED'); if (/^CLIENT_EXTRACTION_FAILED_[A-Z_]+\s*$/.test(stage)) error.stage = stage.trim(); reject(error); }
    });
  });
}
export async function verifyBundle(root, expectedManifestHash, { deep = true, platformOrigin } = {}) {
  check((await fs.lstat(root)).isDirectory() && !(await fs.lstat(root)).isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE');
  const parent = path.dirname(root);
  check(!(await fs.lstat(parent)).isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE');
  const manifestFile = path.join(root, 'bundle-manifest.json'); await regular(manifestFile, 4 * 1024 * 1024);
  const bytes = await fs.readFile(manifestFile); check(sha256(bytes) === expectedManifestHash, 'CLIENT_INTEGRITY_MISMATCH');
  let manifest; try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new SkillError('CLIENT_METADATA_INVALID'); }
  check(exact(manifest, ['schema', 'version', 'files']) && manifest.schema === BUNDLE && VERSION.test(manifest.version) && Array.isArray(manifest.files) && manifest.files.length > 10 && manifest.files.length <= 10000, 'CLIENT_METADATA_INVALID');
  const names = new Set(), files = new Set(['bundle-manifest.json']); let total = 0;
  for (const item of manifest.files) {
    check(exact(item, ['path', 'sha256', 'byteLength']) && payloadPath(item.path) && HASH.test(item.sha256) && Number.isSafeInteger(item.byteLength) && item.byteLength >= 0 && item.byteLength <= 256 * 1024 * 1024, 'CLIENT_METADATA_INVALID');
    check(!names.has(item.path.toLowerCase()), 'CLIENT_METADATA_INVALID'); names.add(item.path.toLowerCase()); files.add(item.path); total += item.byteLength;
    check(total <= MAX_PAYLOAD, 'CLIENT_TOO_LARGE');
    const candidate = path.join(root, ...item.path.split('/')); check(inside(root, candidate), 'CLIENT_DIRECTORY_UNSAFE');
  }
  for (const required of ['client.json', 'node/node.exe', 'connector/bin/native-client.mjs', 'connector/bin/windows-secret.ps1', 'connector/dist/index.js', 'runtime/dist/src/index.js']) check(files.has(required), 'CLIENT_METADATA_INVALID');
  async function walk(directory, prefix = '') {
    for (const name of await fs.readdir(directory)) {
      const item = path.join(directory, name), relative = prefix ? prefix + '/' + name : name, stat = await fs.lstat(item);
      check(!stat.isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE');
      if (stat.isDirectory()) { check([...files].some(file => file.startsWith(relative + '/')), 'CLIENT_UNTRACKED_FILES'); await walk(item, relative); }
      else check(stat.isFile() && stat.nlink === 1 && files.has(relative), 'CLIENT_UNTRACKED_FILES');
    }
  }
  await walk(root);
  // Validate the whole directory topology before opening any payload file.
  for (const item of manifest.files) {
    const candidate = path.join(root, ...item.path.split('/'));
    const stat = await regular(candidate, 256 * 1024 * 1024);
    check(stat.size === item.byteLength, 'CLIENT_INTEGRITY_MISMATCH');
    if (deep || item.path.startsWith('connector/') || item.path === 'client.json' || item.path === 'node/node.exe') {
      check(sha256(await fs.readFile(candidate)) === item.sha256, 'CLIENT_INTEGRITY_MISMATCH');
    }
  }
  const config = await json(path.join(root, 'client.json'));
  check(exact(config, ['schema', 'version', 'platformOrigin', 'deviceProtocol', 'deviceVersion', 'bridgeVersion', 'runtimePath', 'chromiumPath', 'releaseState'])
    && config.schema === 'digital-employee-client/1' && config.version === manifest.version && config.deviceProtocol === 'device-binding'
    && config.deviceVersion === '0.1.1-candidate.1' && config.bridgeVersion === 'native-bridge/1' && config.runtimePath === 'runtime/dist/src/index.js'
    && config.chromiumPath === 'chromium' && ['DEVELOPMENT', 'RELEASED'].includes(config.releaseState)
    && (!platformOrigin || config.platformOrigin === platformOrigin), 'CLIENT_VERSION_INCOMPATIBLE');
  return manifest;
}
async function library(ctx) {
  check(ctx.platform === 'win32' && (ctx.arch ?? process.arch) === 'x64' && path.isAbsolute(ctx.local), 'UNSUPPORTED_OS');
  const local = await fs.realpath(ctx.local), root = path.join(local, 'DigitalEmployeeClient');
  await directories(root); return root;
}
export async function inspectClient(ctx, { channel, deep = true } = {}) {
  channel ??= await readChannel(ctx.source ?? SOURCE);
  const root = await library(ctx), receiptFile = path.join(root, 'client-receipt.json');
  if (!await exists(receiptFile)) return { installed: false, state: 'CLIENT_NOT_INSTALLED' };
  const receipt = await json(receiptFile);
  check(exact(receipt, ['schema', 'version', 'bundleManifestSha256', 'release', 'installedAt', 'installationId']) && receipt.schema === RECEIPT && VERSION.test(receipt.version)
    && HASH.test(receipt.bundleManifestSha256) && utc(receipt.installedAt) && /^[0-9a-f-]{36}$/.test(receipt.installationId), 'CLIENT_METADATA_INVALID');
  const release = verifyRelease(receipt.release, channel);
  check(release.version === receipt.version && release.bundleManifestSha256 === receipt.bundleManifestSha256, 'CLIENT_METADATA_INVALID');
  const installedRoot = path.join(root, 'versions', receipt.version); check(inside(root, installedRoot), 'CLIENT_DIRECTORY_UNSAFE');
  check(!(await fs.lstat(path.join(root, 'versions'))).isSymbolicLink(), 'CLIENT_DIRECTORY_UNSAFE');
  await verifyBundle(installedRoot, receipt.bundleManifestSha256, { deep, platformOrigin: release.platformOrigin });
  return { installed: true, state: 'CLIENT_FILES_VERIFIED', version: receipt.version, root: installedRoot, nativeActivation: 'NOT_VERIFIED' };
}
export async function installClient(ctx, options = {}) {
  const root = await library(ctx), file = path.join(root, 'installation.lock');
  let lock;
  const record = { schema: 'digital-employee-installer-lock/1', id: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3 && !lock; attempt++) {
    try { lock = await fs.open(file, 'wx', 0o600); await lock.writeFile(JSON.stringify(record)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = await json(file);
      check(exact(prior, ['schema', 'id', 'pid', 'createdAt']) && prior.schema === record.schema && /^[0-9a-f-]{36}$/.test(prior.id)
        && Number.isSafeInteger(prior.pid) && prior.pid > 0 && utc(prior.createdAt), 'CLIENT_METADATA_INVALID');
      let alive = true;
      try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      check(!alive, 'CLIENT_INSTALLER_BUSY');
      check(canonical(await json(file)) === canonical(prior), 'CLIENT_INSTALLER_BUSY');
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  check(lock, 'CLIENT_INSTALLER_BUSY');
  try { return await installUnlocked(ctx, options); }
  finally {
    await lock.close();
    const current = await json(file);
    check(current.id === record.id && current.pid === record.pid, 'CLIENT_INSTALLER_BUSY');
    await fs.unlink(file);
  }
}
async function installUnlocked(ctx, { channel, transport = fetch, extractor = expandArchive } = {}) {
  await readSource({ source: ctx.source ?? SOURCE });
  channel ??= await readChannel(ctx.source ?? SOURCE);
  const release = verifyRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await download(channel.releaseUrl, 32768, transport))), channel);
  const root = await library(ctx), versions = await directories(root, 'versions'), destination = path.join(versions, release.version);
  if (await exists(destination)) {
    const manifest = await verifyBundle(destination, release.bundleManifestSha256, { platformOrigin: release.platformOrigin });
    check(manifest.version === release.version, 'CLIENT_VERSION_INCOMPATIBLE');
  } else {
  const downloadRoot = await directories(root, 'downloads'), stageRoot = await directories(root, 'staging');
  const id = randomUUID(), archive = path.join(downloadRoot, id + '.zip'), stage = path.join(stageRoot, id);
  const data = await download(release.archive.url, MAX_ARCHIVE, transport);
  check(data.length === release.archive.byteLength && sha256(data) === release.archive.sha256, 'CLIENT_ARCHIVE_INTEGRITY_MISMATCH');
  await fs.writeFile(archive, data, { flag: 'wx', mode: 0o600 });
  await extractor(archive, stage, ctx.source ?? SOURCE);
  const extracted = path.join(stage, 'digital-employee-client');
  const manifest = await verifyBundle(extracted, release.bundleManifestSha256, { platformOrigin: release.platformOrigin });
  check(manifest.version === release.version, 'CLIENT_VERSION_INCOMPATIBLE');
  // An immutable version directory is retained across updates. No old client,
  // credential, browser profile or backup is removed by installation.
  try { await fs.rename(extracted, destination); }
  catch (error) { if ((await exists(destination))?.isDirectory()) await verifyBundle(destination, release.bundleManifestSha256, { platformOrigin: release.platformOrigin }); else throw error; }
  }
  // Recover a verified immutable version even if receipt activation was interrupted.
  const id = randomUUID();
  const receipt = { schema: RECEIPT, version: release.version, bundleManifestSha256: release.bundleManifestSha256, release, installedAt: new Date().toISOString(), installationId: randomUUID() };
  const receiptFile = path.join(root, 'client-receipt.json'), temporary = path.join(root, 'receipt-' + id + '.tmp');
  if (await exists(receiptFile)) { await regular(receiptFile); await fs.copyFile(receiptFile, path.join(root, 'receipt-backup-' + id + '.json'), constants.COPYFILE_EXCL); }
  await fs.writeFile(temporary, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, receiptFile);
  return { ...(await inspectClient(ctx, { channel, deep: true })), archiveRetained: true, credentialsTouched: false };
}
export async function clientCommand(ctx, command, host, { channel, transport = fetch, extractor = expandArchive, input } = {}) {
  check(['qoder', 'kimi'].includes(host) && ['connect', 'status', 'next', 'respond', 'run', 'result', 'close'].includes(command), 'INVALID_ARGUMENTS');
  await readSource({ source: ctx.source ?? SOURCE });
  channel ??= await readChannel(ctx.source ?? SOURCE);
  let installed = await inspectClient(ctx, { channel, deep: true });
  if (!installed.installed && command === 'connect') installed = await installClient(ctx, { channel, transport, extractor });
  check(installed.installed, 'CLIENT_NOT_INSTALLED');
  const node = path.join(installed.root, 'node', 'node.exe'), script = path.join(installed.root, 'connector', 'bin', 'native-client.mjs');
  const payload = input ?? (['respond', 'run', 'result'].includes(command) ? await readStdin() : {});
  const raw = Buffer.from(JSON.stringify(payload)); check(raw.length <= 1048576, 'INVALID_ARGUMENTS');
  return new Promise((resolveResult, reject) => {
    let output = Buffer.alloc(0), errors = Buffer.alloc(0);
    const env = { NODE_ENV: 'production' };
    for (const name of ['SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP', 'PATH']) if (process.env[name]) env[name] = process.env[name];
    env.LOCALAPPDATA = ctx.local;
    const child = spawn(node, [script, command, '--agent', host], { env, windowsHide: true, shell: false, stdio: 'pipe' });
    const timer = setTimeout(() => { child.kill(); reject(new SkillError(command === 'run' || command === 'respond' ? 'EXECUTION_UNKNOWN' : 'CLIENT_HELPER_TIMEOUT')); }, command === 'next' ? 45000 : 40000);
    child.stdin.on('error', () => {}); child.stdin.end(raw, () => raw.fill(0));
    child.stdout.on('data', chunk => { output = Buffer.concat([output, chunk]); if (output.length > 2097152) child.kill(); });
    child.stderr.on('data', chunk => { errors = Buffer.concat([errors, chunk]); if (errors.length > 16384) child.kill(); });
    child.once('error', () => { clearTimeout(timer); reject(new SkillError('CLIENT_HELPER_UNAVAILABLE')); });
    child.once('exit', code => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(code === 0 ? output : errors));
        if (code !== 0 || value.ok !== true) throw new SkillError(typeof value?.error?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.error.code) ? value.error.code : 'CLIENT_HELPER_FAILED');
        check(exact(value, ['ok', 'data']), 'CLIENT_HELPER_FAILED'); resolveResult(value.data);
      } catch (error) { reject(error instanceof SkillError ? error : new SkillError('CLIENT_HELPER_FAILED')); }
      finally { output.fill(0); errors.fill(0); }
    });
  });
}
async function readStdin() {
  let raw = Buffer.alloc(0);
  for await (const chunk of process.stdin) { check(raw.length + chunk.length <= 1048576, 'INVALID_ARGUMENTS'); raw = Buffer.concat([raw, chunk]); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new SkillError('INVALID_ARGUMENTS'); }
  finally { raw.fill(0); }
}
const invoked = process.argv[1] ? await fs.realpath(path.resolve(process.argv[1])).catch(() => null) : null;
if (invoked && path.relative(invoked, fileURLToPath(import.meta.url)) === '') {
  const [command = 'connect', host] = process.argv.slice(2);
  clientCommand(context(), command, host).then(data => process.stdout.write(JSON.stringify({ ok: true, data }) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: { code: error instanceof SkillError ? error.code : 'CLIENT_OPERATION_FAILED' } }) + '\n'); process.exitCode = 1; });
}
