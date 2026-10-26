const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const {buildSync}=require(path.join(process.env.PARACO_REPO||path.resolve(root,'../paraco'),'node_modules/esbuild'));
for(const name of fs.readdirSync(root)){const dir=path.join(root,name);if(!fs.existsSync(path.join(dir,'paraco.json')))continue;buildSync({entryPoints:[path.join(dir,'main.ts')],outfile:path.join(root,'.compiled',name+'.mjs'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});}
console.log('All eight self-contained application bundles compile.');
