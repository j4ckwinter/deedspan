import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApiApp } from '../../server/app.ts';
import { createApp } from '../../examples/drafts/src/app.ts';
import { DraftStore } from '../../examples/drafts/src/store.ts';

const directory = new URL('./', import.meta.url);
const model = 'panky-qwen3:4b';
const password = crypto.randomUUID();
const database = new URL(`./${crypto.randomUUID()}.sqlite`,directory);
const store = new DraftStore(fileURLToPath(database)); store.seed(password);
const servers = [createServer(),createServer()];
const origins = await Promise.all(servers.map(async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}));
const [origin, proxy] = origins;
servers[0].on('request',createApp(store,origin));
let title;
const record = event => appendFileSync(new URL('./trace.jsonl',directory),JSON.stringify({at:new Date().toISOString(),title,...event})+'\n');
servers[1].on('request',createApiApp({baseUrl:'http://127.0.0.1:11434/v1',model},async(url,options)=>{
  record({kind:'model-request',body:JSON.parse(options.body)});
  const response=await fetch(url,options);
  record({kind:'model-response',status:response.status,body:await response.clone().text()}); return response;
}));
const execute=promisify(execFile);
const invoke=async args=>{
  try {const result=await execute(process.execPath,['--import','tsx','scripts/run-drafts-agent.ts',...args],{env:{...process.env,DRAFTS_PASSWORD:password,DRAFTS_ORIGIN:origin,WORKBENCH_ORIGIN:proxy,DRAFTS_RUN_DIR:fileURLToPath(new URL('./tasks',directory))},timeout:180000});return {exitCode:0,...result};}
  catch(error){return {exitCode:error.code,stdout:error.stdout,stderr:error.stderr};}
};
const results=[];
try {
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password})});
  const {csrf}=await login.json();const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const request=async(path,body)=>{const response=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(response.ok);return response.json();};
  for(title of ['Windows Qwen launch notes 2026-11-06','Windows Qwen autumn campaign 2026-11-06']) {
    const before=await request('/drafts');
    const first=await invoke([title]);
    const metadata=first.stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(x=>x?.taskFile);
    assert(metadata,'CLI persisted task before inference');
    assert.notEqual(first.exitCode,0,'Noninteractive CLI must pause for approval');
    assert.deepEqual(await request('/drafts'),before,'No draft before approval');
    const pending=await request('/approvals');assert.equal(pending.length,1);assert.equal(pending[0].id,metadata.operationId);assert.equal(pending[0].title,title);assert.equal(pending[0].project_id,'marketing');
    const approval=await request('/approvals/'+metadata.operationId,{});
    const resumed=await invoke(['--resume',metadata.taskFile]);
    const after=await request('/drafts');const created=after.filter(d=>!before.some(b=>b.id===d.id));
    const outcome={title,metadata,first,approval,resumed,before,after,calls:await request('/calls'),events:await request('/events')};results.push(outcome);
    writeFileSync(new URL('./results.json',directory),JSON.stringify({model,approval:'Separate authenticated test operator; real CLI subprocess exits and resumes',results},null,2));
    assert.equal(resumed.exitCode,0,resumed.stderr);assert.match(resumed.stdout,/"status": "passed"/);assert.equal(created.length,1);assert.equal(created[0].title,title);assert.equal(created[0].project_id,'marketing');
    const db=new DatabaseSync(database);try{assert.deepEqual({...db.prepare('SELECT * FROM drafts WHERE id = ?').get(created[0].id)},created[0]);}finally{db.close();}
    console.log(JSON.stringify({title,status:'passed',operationId:metadata.operationId,draftId:created[0].id}));
  }
  const tags=await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json());
  writeFileSync(new URL('./environment.json',directory),JSON.stringify({node:process.version,platform:process.platform,ollama:await fetch('http://127.0.0.1:11434/api/version').then(r=>r.json()),model:tags.models.find(m=>m.name===model)},null,2));
} finally {
  await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));store.close();unlinkSync(database);
}
