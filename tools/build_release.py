from pathlib import Path
import argparse,hashlib,json,zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
source=root/'skills'/'digital-employee-connect'
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
allowed={'SKILL.md','agents/openai.yaml','scripts/core.mjs','references/qoder.md','references/kimi.md'}
assert manifest['schema']=='digital-employee-skill/1'
assert manifest['name']=='digital-employee-connect'
assert len(manifest['files'])==len(allowed)
assert {item['path'] for item in manifest['files']}==allowed
for item in manifest['files']:
    file=source/item['path']
    assert not file.is_symlink()
    assert hashlib.sha256(file.read_bytes()).hexdigest()==item['sha256']
out=Path(args.out).resolve()
assert not out.is_relative_to(root), 'Release artifacts must remain outside source repository'
out.mkdir(parents=True,exist_ok=True)
archive=out/('digital-employee-connect-v'+manifest['version']+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for relative in sorted(allowed|{'manifest.json'}):
        info=zipfile.ZipInfo('digital-employee-connect/'+relative,date_time=(1980,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100600<<16
        z.writestr(info,(source/relative).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'SHA256SUMS').write_text(sha+'  '+archive.name+'\n',encoding='utf-8')
print(json.dumps({'archive':archive.name,'sha256':sha,'payloadFiles':len(allowed)+1}))
