#!/usr/bin/env python3
"""Build reproducible, allowlisted marketplace release packages."""
import argparse,base64,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
APPS=('ai-memory-curator','cron-time-machine','github-pulse','json-yaml-workbench','local-uptime-sentry','prompt-regression-lab','scientific-lab-notebook','system-vitals')
FILES=('LICENSE','README.md','app.js','assets.d.ts','index.html','main.ts','package.json','paraco.d.ts','paraco.json','settings.ts','style.css','ui.js')
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--version',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 if not re.fullmatch(r'(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})',a.version):p.error('Invalid version')
 a.output.mkdir(parents=True,exist_ok=True);checksums={}
 for name in APPS:
  directory=ROOT/name;manifest=json.loads((directory/'paraco.json').read_text());assert manifest['name']==name
  paths=FILES+(('yaml.js','YAML-LICENSE') if name=='json-yaml-workbench' else ())
  files=[]
  for path in sorted(paths):
   source=directory/path
   if source.is_symlink() or not source.is_file():raise ValueError('Missing or unsafe package input: '+str(source))
   files.append({'path':path,'content':base64.b64encode(source.read_bytes()).decode('ascii')})
  payload=(json.dumps({'schemaVersion':1,'name':name,'version':a.version,'files':files},sort_keys=True,separators=(',',':'))+'\n').encode()
  filename=name+'.paraco.json';(a.output/filename).write_bytes(payload);checksums[filename]=hashlib.sha256(payload).hexdigest()
 (a.output/'SHA256SUMS').write_text(''.join(digest+'  '+name+'\n' for name,digest in sorted(checksums.items())))
 print(json.dumps(checksums,indent=2))
if __name__=='__main__':main()
