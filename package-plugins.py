from pathlib import Path
import json,shutil,os
root=Path(__file__).parent
apps={
'system-vitals':('System Vitals + Port Scout','A clear view of your computer, from CPU activity to listening ports.','◉',['system'],{}),
'prompt-regression-lab':('Prompt Regression Lab','Catch changes in model behavior before they reach your workflow.','↔',['ai','storage'],{'cases':[],'runs':[]}),
'cron-time-machine':('Cron Time Machine','See exactly when a schedule runs, across dates and time zones.','◷',['tasks','storage'],{'saved':[]}),
'json-yaml-workbench':('JSON / YAML Workbench','Format, convert and explore structured data in one quiet workspace.','{}',[],{}),
'ai-memory-curator':('AI Memory Curator','Keep useful context accurate, organized and ready to reuse.','◇',['storage','ai'],{'memories':[]}),
'local-uptime-sentry':('Local Uptime Sentry','Know which services are responding, and when something changes.','⌁',['tasks'],{}),
'github-pulse':('GitHub Pulse','Follow issues, pull requests and releases across your public repositories.','↗',['tasks'],{}),
'scientific-lab-notebook':('Scientific Lab Notebook','A thoughtful place for questions, experiments and observations.','∴',['storage'],{'entries':[]})}
for slug,(title,description,icon,caps,initial) in apps.items():
 p=root/slug;p.mkdir(exist_ok=True)
 for name in ['style.css','ui.js','assets.d.ts']:shutil.copy(root/'shared'/name,p/name)
 shutil.copy(Path(os.environ.get('PARACO_REPO',str(root.parent/'paraco')))/'runtime/paraco.d.ts',p/'paraco.d.ts')
 (p/'settings.ts').write_text('export const kind: string = '+json.dumps(slug)+';\nexport const initial = '+json.dumps(initial)+';\n')
 (p/'package.json').write_text(json.dumps({'name':'paraco-'+slug,'private':True,'version':'0.1.0','type':'module'},indent=2)+'\n')
 (p/'paraco.json').write_text(json.dumps({'schemaVersion':1,'name':slug,'entrypoint':'main.ts','targets':['local'],'capabilities':caps},indent=2)+'\n')
 (p/'index.html').write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>{title}</title><link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script></head><body><header class="masthead"><div><div class="brand">Personal workspace</div><h1>{title}</h1><p>{description}</p></div><div class="mark" aria-hidden="true">{icon}</div></header><div id="notice" class="notice" role="status" aria-live="polite"></div><main id="app"></main></body></html>''')
 (p/'style.css').write_text((root/'shared/style.css').read_text()+'\n'+'\n'.join(x.read_text() for x in sorted((root/'shared').glob('*-extras.css'))))
 server=(root/'shared/server.ts').read_text()
 if slug=='json-yaml-workbench':
  server=server.replace("import {kind, initial}","import yaml from './yaml.js' with {type:'text'};\nimport {kind, initial}")
  server=server.replace("const json=(v:","assets['/yaml.js']=[yaml,'text/javascript'];\nconst json=(v:")
 (p/'main.ts').write_text(server)
