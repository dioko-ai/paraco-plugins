const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..'),paraco=process.env.PARACO_REPO||path.resolve(root,'../paraco'),slugs=['system-vitals','prompt-regression-lab','cron-time-machine','json-yaml-workbench','ai-memory-curator','local-uptime-sentry','github-pulse','scientific-lab-notebook'];
const {chromium}=require(path.join(paraco,'node_modules/@playwright/test'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'paraco-showcase-test-'));
 let child,browser,output='';
 const target=http.createServer((req,res)=>{res.writeHead(req.url==='/fail'?503:200);res.end('service response');});await new Promise(r=>target.listen(0,'127.0.0.1',r));const targetPort=target.address().port;
 const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const config={apps:slugs.map(slug=>({path:path.join(root,slug),...(['local-uptime-sentry','github-pulse','cron-time-machine'].includes(slug)?{taskAuthoring:true,taskNetwork:slug==='local-uptime-sentry'?[`127.0.0.1:${targetPort}`]:slug==='github-pulse'?['api.github.com:443']:[]}: {})}))};
 await fs.writeFile(path.join(temp,'server.json'),JSON.stringify(config));
 const origin=slug=>`http://${slug}.localhost:${port}`;
 async function call(slug,action,body={},requestOrigin=origin(slug)){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/api/'+action,method:'POST',headers:{Host:`${slug}.localhost:${port}`,Origin:requestOrigin,'Content-Type':'application/json'}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>{try{resolve({status:res.statusCode,value:data?JSON.parse(data):null})}catch{reject(Error(`${slug}/${action} HTTP ${res.statusCode}: ${data}\n${output}`));}});});req.on('error',reject);req.end(JSON.stringify(body));});}
 const post=async(slug,action,body={})=>{const r=await call(slug,action,body);assert.equal(r.status,200,`${slug}/${action}: ${JSON.stringify(r.value)}`);return r.value;};
 async function start(){child=spawn(path.join(paraco,'target/debug/paraco'),['--log-dir',path.join(temp,'logs'),'serve','--config',path.join(temp,'server.json'),'--port',String(port)],{env:{...process.env,PATH:path.join(paraco,'node_modules/.bin')+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error(output);try{const r=await fetch(`http://127.0.0.1:${port}/`,{headers:{Host:`system-vitals.localhost:${port}`}});if(r.ok){await sleep(1500);return;}}catch{}await sleep(100);}throw Error(output);}
 async function stop(){if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await exited;}child=null;}
 try{
 await start();
 const snap=await post('system-vitals','snapshot');assert(snap.memory.total>0);assert(snap.cpu.total>snap.cpu.idle);assert(snap.ports.some(p=>p.port===targetPort));
 const cron=await post('cron-time-machine','preview',{expression:'0 9 * * 1-5',timezone:'America/Los_Angeles',after:Date.parse('2026-10-26T00:00:00Z')});assert.equal(cron.times.length,5);assert.equal(new Date(cron.times[0]).toISOString(),'2026-10-26T16:00:00.000Z');
 const entry={id:'test-entry',title:'Plant growth observations',project:'Windowsill study',date:'2026-10-26',status:'in-progress',tags:['plants'],hypothesis:'More daylight increases growth.',method:'Measure stem height at the same time each day.',observations:'Three new leaves observed.',conclusion:'Continue measurements.',createdAt:Date.now(),updatedAt:Date.now()};
 const saved=await post('scientific-lab-notebook','save',{value:{entries:[entry]},version:null});assert.equal(saved.version,1);
 assert.equal((await call('scientific-lab-notebook','save',{value:{entries:[]},version:null})).status,409);
 const memory={id:'memory-1',title:'Writing preferences',content:'Use concise sentences and concrete examples.',source:'Personal notes',tags:['writing'],status:'active',confidence:'confirmed',createdAt:Date.now(),updatedAt:Date.now()};await post('ai-memory-curator','save',{value:{memories:[memory]},version:null});
 assert.equal((await call('ai-memory-curator','load',{dataset:'ungranted'})).status,400);
 assert.equal((await call('prompt-regression-lab','evaluate',{prompt:'Hello',rule:{kind:'contains',expected:'hello'}})).status,400);
 const job=await post('local-uptime-sentry','create',{name:'Local service',url:`http://127.0.0.1:${targetPort}/`,interval:5,expectedStatus:200});
 let monitors;for(let i=0;i<120;i++){monitors=await post('local-uptime-sentry','monitors');if(monitors.history.some(h=>h.job_id===job.job_id&&h.status==='succeeded'))break;await sleep(200);}assert(monitors.history.some(h=>h.status==='succeeded'));
 const log=await post('local-uptime-sentry','logs',{run_id:monitors.history[0].id});assert(log.logs.includes('PARACO_RESULT:'));assert(log.logs.includes('"ok":true'));
 assert.equal((await call('local-uptime-sentry','create',{name:'Denied',url:'http://example.invalid/',interval:5,expectedStatus:200})).status,400);
 await post('local-uptime-sentry','archive',{job_id:job.job_id});
 const failed=await post('local-uptime-sentry','create',{name:'Unhealthy service',url:`http://127.0.0.1:${targetPort}/fail`,interval:5,expectedStatus:200});
 for(let i=0;i<120;i++){monitors=await post('local-uptime-sentry','monitors');if(monitors.history.some(h=>h.job_id===failed.job_id&&h.status==='failed'))break;await sleep(200);}assert(monitors.history.some(h=>h.job_id===failed.job_id&&h.status==='failed'));assert(monitors.notifications.length>0);
 // No fake GitHub data or external traffic: verify empty dashboard and malformed input.
 assert.equal((await post('github-pulse','repositories')).jobs.length,0);
 assert.equal((await call('github-pulse','create',{repository:'../bad',interval:15})).status,400);
 const forbidden=await call('scientific-lab-notebook','save',{},'http://other.invalid');assert.equal(forbidden.status,403);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const slug of slugs){await page.goto(origin(slug));await page.waitForTimeout(slug==='system-vitals'?2300:900);assert(await page.locator('main').innerText(),slug+' has no content');assert.equal(await page.locator('h1').count(),1,slug+' should have one heading');await page.screenshot({path:path.join(root,'screenshots',slug+'.png'),fullPage:true});console.log('Browser opened:',slug);}
 // Notebook edit persists through a real UI save.
 await page.goto(origin('scientific-lab-notebook'));await page.locator('[data-action="select"][data-id="test-entry"]').click();await page.locator('input[name="title"]').waitFor();await page.locator('input[name="title"]').fill('Revised plant observations');await page.getByRole('button',{name:'Save experiment',exact:true}).click();await page.waitForTimeout(350);assert.equal((await post('scientific-lab-notebook','load')).value.entries[0].title,'Revised plant observations');
 await page.goto(origin('json-yaml-workbench'));await page.waitForTimeout(300);await page.locator('#source').fill('name: sample\nvalues: [1, 2, 3]');await page.locator('#output-format').selectOption('json');await page.locator('#convert').click();assert.deepEqual(JSON.parse(await page.locator('#source').inputValue()),{name:'sample',values:[1,2,3]});
 await page.locator('#source').fill('key: 1\nkey: 2');await page.locator('#input-format').selectOption('yaml');await page.locator('#format').click();assert.match(await page.locator('#message').innerText(),/unique|duplicate/i);
 await page.locator('#source').fill('{"text":"<img src=x onerror=alert(1)>"}');await page.locator('#input-format').selectOption('json');await page.locator('#format').click();assert.equal(await page.locator('#tree img').count(),0);
 const fileEvent=page.waitForEvent('download');await page.locator('#download').click();assert((await fileEvent).suggestedFilename().endsWith('.json'));
 await page.goto(origin('cron-time-machine'));await page.locator('#bookmark-name').fill('Morning report');await page.getByRole('button',{name:'Save current schedule'}).click();await page.waitForTimeout(400);assert.equal((await post('cron-time-machine','load')).value.saved[0].name,'Morning report');
 await page.goto(origin('prompt-regression-lab'));await page.locator('#case-name').fill('Greeting');await page.locator('#case-prompt').fill('Say hello');await page.locator('#case-expected').fill('hello');await page.getByRole('button',{name:'Save case',exact:true}).click();await page.waitForTimeout(350);await page.locator('#run-suite').click();await page.waitForFunction(()=>document.querySelector('#run-status').textContent.includes('Results saved'));const suite=await post('prompt-regression-lab','load');assert.equal(suite.value.runs.length,1);assert.match(suite.value.runs[0].results[0].error,/AI request failed|Connect an AI provider/);
 await page.setViewportSize({width:390,height:844});for(const slug of slugs){await page.goto(origin(slug));await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),slug+' mobile overflows');}
 assert.deepEqual(errors,[],'Browser errors');
 await stop();await start();assert.equal((await post('scientific-lab-notebook','load')).value.entries[0].title,'Revised plant observations');assert.equal((await post('ai-memory-curator','load')).value.memories[0].id,'memory-1');
 console.log('PASS: real host, eight browser views/mobile, storage/restart/conflicts, scheduler preview, uptime success/failure/notification, permission denial, telemetry and CSRF.');
 }finally{if(browser)await browser.close();await stop();await new Promise(r=>target.close(r));await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
