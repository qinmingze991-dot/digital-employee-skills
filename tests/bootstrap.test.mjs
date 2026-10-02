import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PAYLOAD, installSkill, context, NAME } from '../skills/digital-employee-connect/scripts/core.mjs';
import { canonical, sha256, readChannel, verifyRelease, verifyBundle, installClient, inspectClient } from '../skills/digital-employee-connect/scripts/bootstrap.mjs';
const original=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/digital-employee-connect');
const testRoot=process.env.DE_SKILL_TEST_ROOT??path.join(os.tmpdir(),'digital-employee-bootstrap-tests');
const keys=generateKeyPairSync('ed25519');
const channel={schema:'digital-employee-release-channel/1',releaseBase:'https://github.com/example/fixture/releases/download/test',releaseUrl:'https://github.com/example/fixture/releases/download/test/client-release.json',platformOrigin:'https://platform.example',
  publicKey:keys.publicKey.export({type:'spki',format:'pem'}),keyId:sha256(keys.publicKey.export({type:'spki',format:'der'})).slice(0,16),
  nodeVersion:'24.18.0',nodeUrl:'https://nodejs.org/dist/v24.18.0/win-x64/node.exe',nodeSha256:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'};
function release(metadata, version='0.1.1-preview.1', platformOrigin=channel.platformOrigin){
  const value={schema:'digital-employee-client-release/1',version,platform:'win32-x64',nodeVersion:'24.18.0',bridgeVersion:'native-bridge/1',contractVersion:'0.1.0-draft.2',deviceProtocol:'device-binding',deviceVersion:'0.1.1-candidate.1',platformOrigin,
    archive:{url:channel.releaseBase+'/digital-employee-client-v'+version+'-win-x64.zip',sha256:metadata.sha256,byteLength:metadata.byteLength},
    bundleManifestSha256:metadata.bundleManifestSha256,publishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),keyId:channel.keyId};
  return {...value,signature:sign(null,Buffer.from(canonical(value)),keys.privateKey).toString('base64')};
}
async function fixture(){
  await fs.mkdir(testRoot,{recursive:true});
  const root=await fs.realpath(await fs.mkdtemp(path.join(testRoot,'bootstrap-')));
  const local=path.join(root,'local'),bundle=path.join(root,'bundle'); await fs.mkdir(local); await fs.mkdir(bundle);
  const names=['client.json','node/node.exe','node/LICENSE','connector/bin/native-client.mjs','connector/bin/windows-secret.ps1','connector/dist/index.js',
    'connector/package.json','runtime/dist/src/index.js','runtime/dist/src/network-policy.js','runtime/package.json','node_modules/playwright/index.js','chromium/browser.exe'];
  const files=[];
  const config={schema:'digital-employee-client/1',version:'0.1.1-preview.1',platformOrigin:channel.platformOrigin,deviceProtocol:'device-binding',deviceVersion:'0.1.1-candidate.1',bridgeVersion:'native-bridge/1',runtimePath:'runtime/dist/src/index.js',chromiumPath:'chromium',releaseState:'DEVELOPMENT'};
  for(const name of names){ const data=Buffer.from(name==='client.json'?JSON.stringify(config):'test fixture '+name); await fs.mkdir(path.dirname(path.join(bundle,name)),{recursive:true}); await fs.writeFile(path.join(bundle,name),data); files.push({path:name,sha256:sha256(data),byteLength:data.length}); }
  const bytes=Buffer.from(JSON.stringify({schema:'digital-employee-client-bundle/1',version:'0.1.1-preview.1',files}));
  await fs.writeFile(path.join(bundle,'bundle-manifest.json'),bytes);
  const archive=Buffer.from('synthetic archive transport fixture'),signed=release({sha256:sha256(archive),byteLength:archive.length,bundleManifestSha256:sha256(bytes)});
  const ctx={platform:'win32',arch:'x64',local,source:original};
  let fetchCalls=0,extractCalls=0;
  const transport=async(url,options)=>{fetchCalls++;assert.equal(options.redirect,'manual'); if(url===channel.releaseUrl)return new Response(JSON.stringify(signed)); if(url===signed.archive.url)return new Response(archive); throw Error('unapproved URL');};
  const extractor=async(_archive,destination)=>{extractCalls++; await fs.mkdir(destination,{recursive:true}); await fs.cp(bundle,path.join(destination,'digital-employee-client'),{recursive:true});};
  return {root,local,bundle,ctx,signed,transport,extractor,get fetchCalls(){return fetchCalls},get extractCalls(){return extractCalls}};
}
const rejects=(action,code)=>assert.rejects(action,error=>error.code===code);
test('default channel refuses unpublished release before any download',async()=>{
  await rejects(()=>readChannel(original),'RELEASE_NOT_AVAILABLE');
  const child=spawnSync(process.execPath,[path.join(original,'scripts/core.mjs'),'connect','--host','kimi'],{encoding:'utf8'});
  assert.equal(child.status,1);
  assert.ok(['RELEASE_NOT_AVAILABLE','UNSUPPORTED_OS'].includes(JSON.parse(child.stderr).error.code));
});
test('signature binds protocol, platform, archive and expiry; downloaded keys cannot replace trust',async()=>{
  const f=await fixture(); assert.equal(verifyRelease(f.signed,channel).version,'0.1.1-preview.1');
  for(const patch of [{signature:'A'.repeat(86)+'=='},{platformOrigin:'https://attacker.example'},{deviceVersion:'new'}, {archive:{...f.signed.archive,url:'https://attacker.example/payload.zip'}},{expiresAt:new Date(Date.now()-1000).toISOString()},{extra:'ignored'}]){
    assert.throws(()=>verifyRelease({...f.signed,...patch},channel));
  }
  const other=generateKeyPairSync('ed25519');
  const {signature,...unsigned}=f.signed;
  assert.throws(()=>verifyRelease({...unsigned,signature:sign(null,Buffer.from(canonical(unsigned)),other.privateKey).toString('base64')},channel),{code:'RELEASE_SIGNATURE_INVALID'});
});
test('install verifies first, retains archive, supports interrupted receipt recovery and preserves credentials',async()=>{
  const f=await fixture(),credential=path.join(f.local,'device-sentinel.dpapi'); await fs.writeFile(credential,'synthetic credential sentinel');
  const first=await installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor}); assert.equal(first.installed,true); assert.equal(first.credentialsTouched,false);
  const receipt=path.join(f.local,'DigitalEmployeeClient/client-receipt.json');
  await fs.rename(receipt,receipt+'.interrupted');
  const recovered=await installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor});
  assert.equal(recovered.installed,true); assert.equal(f.extractCalls,1); assert.equal(await fs.readFile(credential,'utf8'),'synthetic credential sentinel');
  assert.equal((await inspectClient(f.ctx,{channel})).nativeActivation,'NOT_VERIFIED');
});
test('bad archive and redirected host are refused before extraction',async()=>{
  const f=await fixture();
  const corrupt=async url=>url===channel.releaseUrl?new Response(JSON.stringify(f.signed)):new Response('tampered');
  await rejects(()=>installClient(f.ctx,{channel,transport:corrupt,extractor:f.extractor}),'CLIENT_ARCHIVE_INTEGRITY_MISMATCH');
  assert.equal(f.extractCalls,0);
  await rejects(()=>installClient(f.ctx,{channel,transport:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),extractor:f.extractor}),'RELEASE_URL_UNTRUSTED');
  assert.equal(f.extractCalls,0);
});
test('bundle catches Runtime tamper, unknown files, hardlinks and ancestor junctions',async()=>{
  const f=await fixture(),hash=f.signed.bundleManifestSha256;
  await verifyBundle(f.bundle,hash);
  const runtime=path.join(f.bundle,'runtime/dist/src/index.js'),bytes=await fs.readFile(runtime);
  await fs.writeFile(runtime,'tampered runtime');
  await rejects(()=>verifyBundle(f.bundle,hash),'CLIENT_INTEGRITY_MISMATCH');
  await fs.writeFile(runtime,bytes);
  await fs.writeFile(path.join(f.bundle,'unknown'),'untracked');
  await rejects(()=>verifyBundle(f.bundle,hash),'CLIENT_UNTRACKED_FILES'); await fs.unlink(path.join(f.bundle,'unknown'));
  await fs.link(runtime,path.join(f.root,'outside-link'));
  await rejects(()=>verifyBundle(f.bundle,hash),'CLIENT_UNTRACKED_FILES'); await fs.unlink(path.join(f.root,'outside-link'));
  const old=path.join(f.bundle,'runtime'),outside=path.join(f.root,'outside-runtime'); await fs.rename(old,outside);
  await fs.symlink(outside,old,process.platform==='win32'?'junction':'dir');
  await rejects(()=>verifyBundle(f.bundle,hash),'CLIENT_DIRECTORY_UNSAFE');
});
test('concurrent installer refuses overlap and never exposes partially activated receipt',async()=>{
  const f=await fixture(); let releaseWait; const gate=new Promise(resolve=>{releaseWait=resolve}); let entered;
  const started=new Promise(resolve=>{entered=resolve});
  const first=installClient(f.ctx,{channel,transport:async(...args)=>{entered();await gate;return f.transport(...args)},extractor:f.extractor});
  await started;
  await rejects(()=>installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor}),'CLIENT_INSTALLER_BUSY');
  assert.equal((await inspectClient(f.ctx,{channel})).installed,false); releaseWait(); assert.equal((await first).installed,true);
});
test('published v0.1.0 five-file manifest upgrades with retained original bytes',async()=>{
  const f=await fixture(),home=path.join(f.root,'home'),roaming=path.join(f.root,'roaming');
  await fs.mkdir(path.join(home,'.qoder/skills'),{recursive:true}); await fs.mkdir(roaming);
  const ctx=context({platform:'win32',home,roaming,local:f.local,source:original});
  const target=path.join(home,'.qoder/skills',NAME); await fs.mkdir(target);
  const paths=['SKILL.md','agents/openai.yaml','scripts/core.mjs','references/qoder.md','references/kimi.md'],files=[];
  for(const relative of paths){const data=await fs.readFile(path.join(original,relative));await fs.mkdir(path.dirname(path.join(target,relative)),{recursive:true});await fs.writeFile(path.join(target,relative),data);files.push({path:relative,sha256:sha256(data)})}
  const manifest=Buffer.from(JSON.stringify({schema:'digital-employee-skill/1',name:NAME,version:'0.1.0-preview.1',files}));
  await fs.writeFile(path.join(target,'manifest.json'),manifest);
  await fs.writeFile(path.join(target,'.digital-employee-install.json'),JSON.stringify({schema:'digital-employee-skill/1',name:NAME,host:'qoder',version:'0.1.0-preview.1',manifestSha256:sha256(manifest),installedAt:new Date().toISOString()}));
  const updated=await installSkill(ctx,'qoder',{replace:true});assert.equal(updated.version,'0.1.1-preview.1');
  assert.deepEqual(await fs.readFile(path.join(updated.backup,'manifest.json')),manifest);
});
test('a dead owned installer lock is recoverable; malformed and live locks are preserved',async()=>{
  const f=await fixture(),library=path.join(f.local,'DigitalEmployeeClient');await fs.mkdir(library);
  const file=path.join(library,'installation.lock');
  const stale={schema:'digital-employee-installer-lock/1',id:'00000000-0000-4000-8000-000000000001',pid:2147483647,createdAt:new Date().toISOString()};
  await fs.writeFile(file,JSON.stringify(stale));
  const result=await installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor});assert.equal(result.installed,true);
  await fs.writeFile(file,JSON.stringify({...stale,pid:process.pid}));
  await rejects(()=>installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor}),'CLIENT_INSTALLER_BUSY');
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).pid,process.pid);
  await fs.writeFile(file,JSON.stringify({foreign:'do not delete'}));
  await rejects(()=>installClient(f.ctx,{channel,transport:f.transport,extractor:f.extractor}),'CLIENT_METADATA_INVALID');
  assert.equal(await fs.readFile(file,'utf8'),'{"foreign":"do not delete"}');
});
test('actual Windows ZIP extraction and complete portable bundle verification', {skip:process.platform!=='win32'||!process.env.DE_PORTABLE_BUILD},async()=>{
  const build=process.env.DE_PORTABLE_BUILD, metadata=JSON.parse(await fs.readFile(path.join(build,'artifact-metadata.json'),'utf8'));
  const archive=await fs.readFile(path.join(build,metadata.archive)),actualChannel={...channel,platformOrigin:'https://s.souvi.com'},signed=release(metadata,'0.1.1-preview.1',actualChannel.platformOrigin),f=await fixture();
  const installed=await installClient(f.ctx,{channel:actualChannel,transport:async url=>url===channel.releaseUrl?new Response(JSON.stringify(signed)):new Response(archive)});
  assert.equal(installed.installed,true);
  const child=spawnSync(path.join(installed.root,'node/node.exe'),[path.join(installed.root,'connector/bin/native-client.mjs'),'help'],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).data.nativeActivation,'NOT_VERIFIED');
  const tree=JSON.parse(await fs.readFile(path.join(installed.root,'bundle-manifest.json'),'utf8'));
  assert.ok(tree.files.some(item=>item.path.startsWith('chromium/chromium_headless_shell-1243/')));
  assert.ok(!tree.files.some(item=>item.path.includes('.links')||item.path.includes('.env')||item.path.endsWith('.dpapi')));
});
