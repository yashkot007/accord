#!/usr/bin/env node
// NON-PRODUCTION: real Worker/MCP code, fresh local D1, synthetic identities only.
// Run: node scripts/measure-agent-load.mjs --rows=250 --concurrency=1,2
// Compare committed code: add --revision=<git-ref>. Reports live in /private/tmp.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {build} from 'esbuild';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const options={rows:250,reads:60,writes:8,concurrency:[1,2],revision:null,output:null,contactOnly:false,inboxProjection:'full',clientHeavyCap:2,checkOnly:false};
for (const arg of process.argv.slice(2)) {
  if (arg==='--help') {
    console.log('Isolated local Worker/D1 measurement; never a production capacity claim.\nOptions: --rows=250 --reads=60 --writes=8 --concurrency=1,2 --inbox-projection=summary|full (default full) --revision=<git-ref> --contact-only --check --output=/private/tmp/report.json. --check builds only; no runtime or database. Current admitted workloads use at most two requests; separate probes deliberately overload the real default guard.');
    process.exit(0);
  }
  if (arg==='--contact-only') {options.contactOnly=true;continue;}
  if (arg==='--check') {options.checkOnly=true;continue;}
  const [key,...parts]=arg.replace(/^--/,'').split('='), value=parts.join('=');
  assert.ok(['rows','reads','writes','concurrency','revision','output','inbox-projection'].includes(key)&&value,`Unknown option: ${arg}`);
  options[key==='inbox-projection'?'inboxProjection':key]=key==='concurrency'?value.split(',').map(Number):['rows','reads','writes'].includes(key)?Number(value):value;
}
assert.ok(['summary','full'].includes(options.inboxProjection),'Invalid inbox projection');
for(const [key,max] of [['rows',5000],['reads',3000],['writes',100]]) assert.ok(Number.isSafeInteger(options[key])&&options[key]>=1&&options[key]<=max,`Invalid ${key}`);
assert.ok(options.concurrency.length<=6&&new Set(options.concurrency).size===options.concurrency.length&&options.concurrency.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=100),'Invalid or duplicate concurrency');
if(options.output) assert.ok(path.resolve(options.output).startsWith('/private/tmp/'),'Reports must be written in /private/tmp');
const gitRaw=(...args)=>execFileSync('git',args,{cwd:projectRoot,encoding:'utf8'});
const git=(...args)=>gitRaw(...args).trim();
const revision=options.revision?git('rev-parse','--verify',options.revision+'^{commit}'):git('rev-parse','HEAD');
const root=await mkdtemp('/private/tmp/accord-agent-load-');
const output=options.output||root+'.json';
// Set paths before importing Miniflare; it caches environment configuration.
process.env.SITES_RUNTIME_ROOT=root;
await import('./sites-env.mjs');
const {Miniflare,Log,LogLevel}=await import('miniflare');
const source=async relative=>options.revision?gitRaw('show',revision+':'+relative):await readFile(path.join(projectRoot,relative),'utf8');
const hasAdmission=options.revision?!!git('ls-tree','-r','--name-only',revision,'lib/mcp-admission.ts'):(await readdir(path.join(projectRoot,'lib'))).includes('mcp-admission.ts');
const hasByteBounds=(await source('lib/workspace.ts')).includes('agentPageByteBudget');
if(hasAdmission)assert.ok(options.concurrency.every(n=>n<=2),'Admitted workloads must use concurrency 1 or 2; overload is measured separately.');
const migrations=options.revision?git('ls-tree','-r','--name-only',revision,'drizzle').split('\n').filter(f=>/^drizzle\/[^/]+\.sql$/.test(f)).sort():(await readdir(path.join(projectRoot,'drizzle'))).filter(f=>f.endsWith('.sql')).sort().map(f=>'drizzle/'+f);
const migrationSql=[];
for(const migration of migrations) migrationSql.push(...(await source(migration)).split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean));

function newMetrics(){return {statements:0,round_trips:0,write_statements:0,agent_update_statements:0,agent_rows_changed:0,rows_written:0,rows_read:0,meta_results:0};}

function instrumentDatabase(db,metrics,beforeQuery=null) {
  const count=(sql,roundTrip=true)=>{
    metrics.statements++; if(roundTrip)metrics.round_trips++;
    const write=/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql); if(write)metrics.write_statements++;
    if(/^\s*UPDATE\s+agents\b/i.test(sql))metrics.agent_update_statements++;
  };
  const meta=(result,sql)=>{
    if(result?.meta){metrics.rows_written+=result.meta.rows_written||0;metrics.rows_read+=result.meta.rows_read||0;metrics.meta_results++;if(/^\s*UPDATE\s+agents\b/i.test(sql))metrics.agent_rows_changed+=result.meta.changes||0;}
    if(metrics.trace)metrics.trace.push({sql:sql.replace(/\s+/g,' ').trim(),meta:result?.meta??null});
    return result;
  };
  const wrap=(sql,statement)=>({
    sql,statement,
    bind(...values){return wrap(sql,statement.bind(...values));},
    // D1 first() discards metadata. Execute the identical SQL once with all()
    // and project its first row, so UPDATE RETURNING writes remain observable.
    async first(column){if(beforeQuery)await beforeQuery();count(sql);const result=meta(await statement.all(),sql);const row=result.results?.[0]??null;return column===undefined?row:row?.[column]??null;},
    async all(...args){if(beforeQuery)await beforeQuery();count(sql);return meta(await statement.all(...args),sql);},
    async run(...args){if(beforeQuery)await beforeQuery();count(sql);return meta(await statement.run(...args),sql);},
  });
  return {
    prepare(sql){return wrap(sql,db.prepare(sql));},
    async batch(statements){if(beforeQuery)await beforeQuery();metrics.round_trips++;for(const s of statements)count(s.sql,false);const results=await db.batch(statements.map(s=>s.statement));results.forEach((result,i)=>meta(result,statements[i].sql));return results;},
  };
}

function observeAdmission(admission) {
  let peaks={bodies:0,tools:0,heavyReads:0,accounts:0,perAccount:0},rejected={body:0,tool:0,account:0};
  const accounts=new Map();
  for(const [method,stage] of [['claimBody','body'],['claimTool','tool'],['claimAccount','account']]) {
    const original=admission[method].bind(admission);
    admission[method]=(...args)=>{
      const release=original(...args);if(!release){rejected[stage]++;return null;}
      if(stage==='account')accounts.set(args[0],(accounts.get(args[0])||0)+1);
      const usage=admission.usage;for(const key of ['bodies','tools','heavyReads','accounts'])peaks[key]=Math.max(peaks[key],usage[key]);
      peaks.perAccount=Math.max(peaks.perAccount,...accounts.values(),0);
      let active=true;
      return()=>{if(!active)return;active=false;release();if(stage==='account'){const count=accounts.get(args[0])-1;if(count)accounts.set(args[0],count);else accounts.delete(args[0]);}};
    };
  }
  return {snapshot:()=>({limits:admission.limits,usage:admission.usage,peaks:{...peaks},rejected:{...rejected}}),reset:()=>{if(Object.values(admission.usage).some(Boolean))throw Error('Cannot reset an active admission observer');peaks={bodies:0,tools:0,heavyReads:0,accounts:0,perAccount:0};rejected={body:0,tool:0,account:0};}};
}

async function seedUnicodeFixture(db,f) {
  const agent='unicode-recipient',grant='unicode-grant',date='2025-02-01T00:00:00.000Z';
  await db.batch([
    db.prepare('INSERT INTO agents(id,owner_id,name,provider,status,created_at) VALUES (?,?,?,?,?,?)').bind(agent,f.users.recipient.id,'Unicode recipient','Synthetic fixture','pending',date),
    db.prepare('INSERT INTO space_agents(space_id,agent_id) VALUES (?,?)').bind(f.space_id,agent),
    db.prepare("INSERT INTO grants(id,space_id,from_agent,to_agent,scope,allow_assign,allow_context,status,expires_at,created_at) VALUES (?,?,?,?,?,1,1,'active',?,?)").bind(grant,f.space_id,f.sender_id,agent,'Unicode probe',new Date(Date.now()+86400000).toISOString(),date),
  ]);
  const text={body:'界'.repeat(8000),feedback:'語'.repeat(8000),adopted:'指'.repeat(5000),reason:'由'.repeat(3000),previous:'旧'.repeat(5000),instruction:'新'.repeat(5000),note:'記'.repeat(2000)};
  let statements=[];
  for(let i=0;i<100;i++) {
    const suffix=String(i).padStart(3,'0'),task='unicode-task-'+suffix,change='unicode-change-'+suffix,version=i===0?100:1;
    statements.push(db.prepare("INSERT INTO tasks(id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,channel,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,'working',?,'agent',?,?,?)").bind(task,f.space_id,grant,f.sender_id,agent,'Unicode task '+suffix,text.body,text.feedback,date,date,version));
    statements.push(db.prepare("INSERT INTO changes(id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,adopted,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,'accepted',?,?,?,?)").bind(change,f.space_id,grant,f.sender_id,agent,'Unicode guidance '+suffix,text.previous,text.instruction,text.reason,'Unicode probe',text.adopted,date,date,version));
    statements.push(db.prepare("INSERT INTO task_updates(id,task_id,version,status,feedback,actor_id,agent_id,channel,created_at) VALUES (?,?,?,'working',?,?,?,'agent',?)").bind('unicode-update-'+suffix,'unicode-task-000',i+1,text.feedback,f.users.recipient.id,agent,date));
    statements.push(db.prepare("INSERT INTO context_decisions(id,change_id,version,status,adopted,note,actor_id,channel,created_at) VALUES (?,?,?,'accepted',?,?,?,'human',?)").bind('unicode-decision-'+suffix,'unicode-change-000',i+1,text.adopted,text.note,f.users.recipient.id,date));
    if(statements.length>=80){await db.batch(statements);statements=[];}
  }
  if(statements.length)await db.batch(statements);
  return {agent_id:agent,tasks:100,context:100,task_history:100,decision_history:100,characters:{body:8000,feedback:8000,adopted:5000,reason:3000,note:2000},bytes_per_cjk_character:3};
}

async function runAdmissionProbe(handle,admission,observer,WorkspaceClass,db,f) {
  const records=[],encoder=new TextEncoder();let sequence=100000;
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const call=(name,args={})=>({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args}});
  const message=method=>({jsonrpc:'2.0',id:++sequence,method,...(method==='initialize'?{params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-overload-probe',version:'1'}}}:{})});
  const gate=()=>{let open;const value={waiting:0};const promise=new Promise(resolve=>{open=resolve;});value.wait=async()=>{value.waiting++;await promise;};value.open=open;return value;};
  const waitFor=async(test)=>{const deadline=Date.now()+2000;while(!test()){if(Date.now()>deadline)throw Error('Synthetic admission gate did not reach its expected occupancy');await new Promise(resolve=>setTimeout(resolve,2));}};
  const request=(value,stream)=>new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:stream||JSON.stringify(value)});
  const run=async(phase,user,value,beforeQuery=null,customRequest=null)=>{
    const metrics=newMetrics();let resolved=0;const start=Date.now();
    const response=await handle(customRequest||request(value),async()=>{resolved++;return new WorkspaceClass(instrumentDatabase(db,metrics,beforeQuery),typeof user==='string'?f.users[user]:user);});
    const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{/* Retain malformed replies in the probe report. */}
    const record={phase,status:response.status,ms:Date.now()-start,bytes:encoder.encode(text).byteLength,retry_after:response.headers.get('Retry-After'),cache_control:response.headers.get('Cache-Control'),resolved,metrics,body,...(body===null?{error:'Malformed JSON reply'}:{})};
    records.push(record);return record;
  };
  const denied=record=>{check(record.status===429,'Expected overload429');check(record.retry_after==='1','Missing Retry-After1');check(record.cache_control==='no-store','Missing no-store');check(record.body?.error?.code===-32000,'Expected recoverable JSON-RPC overload error');for(const key of ['statements','write_statements','agent_update_statements','rows_written'])check(record.metrics[key]===0,'Rejected request executed database work');};
  const accepted=record=>{check(record.status===200&&record.body?.jsonrpc==='2.0'&&!record.body.error&&!record.body.result?.isError,'Expected an admitted successful request');};
  const discovery=async(phase)=>{for(const method of ['ping','tools/list','initialize']){const record=await run(phase,'recipient',message(method));accepted(record);check(record.resolved===0&&record.metrics.statements===0,'Discovery resolved private identity');}};
  observer.reset();
  try {
    // Hold actual dispatched work just before its first SQL call. The real
    // default leases and limits are retained; the gate performs no replay.
    {
      const held=gate(),pending=Array.from({length:admission.limits.heavyReads},()=>run('heavy-holder','recipient',call('read_context',{agent_id:f.recipient_id,limit:1}),held.wait));
      try {await waitFor(()=>held.waiting===admission.limits.heavyReads);check(admission.usage.heavyReads===2,'Expected two actual heavy slots');const excess=await run('heavy-rejection','recipient',call('read_context',{agent_id:f.recipient_id,limit:1}));denied(excess);check(excess.resolved===0,'Heavy rejection happened after identity resolution');await discovery('heavy-discovery');}
      finally {held.open();(await Promise.all(pending)).forEach(accepted);}
    }
    {
      const held=gate(),pending=Array.from({length:admission.limits.perAccount},()=>run('account-holder','recipient',call('read_inbox',{agent_id:f.recipient_id,projection:'summary',limit:1}),held.wait));
      try {
        await waitFor(()=>held.waiting===admission.limits.perAccount);
        for(const value of [call('connect_agent',{agent_id:f.recipient_id}),call('report_progress',{agent_id:f.recipient_id,task_id:'workload-task-000000',expected_version:0,request_id:'burst-denied-progress',status:'working',feedback:'Synthetic overload probe'})]){const excess=await run('account-rejection','recipient',value);denied(excess);check(excess.resolved===1,'Account rejection must resolve fresh identity');}
        const other=await run('account-other-owner','sender',call('list_my_agents'));accepted(other);await discovery('account-discovery');
      } finally {held.open();(await Promise.all(pending)).forEach(accepted);}
    }
    {
      const held=gate(),pending=Array.from({length:admission.limits.tools},(_,i)=>run('tool-holder',{id:'workload-burst-'+i,email:'burst-'+i+'@example.test',name:'Synthetic burst owner'},call('list_my_agents'),held.wait));
      try {await waitFor(()=>held.waiting===admission.limits.tools);check(admission.usage.tools===12,'Expected twelve actual tool slots');const excess=await run('tool-rejection','recipient',call('connect_agent',{agent_id:f.recipient_id}));denied(excess);check(excess.resolved===0,'Global tool rejection happened after identity resolution');await discovery('tool-discovery');}
      finally {held.open();(await Promise.all(pending)).forEach(accepted);}
    }
    {
      const controllers=[],pending=[];
      for(let i=0;i<admission.limits.bodies;i++) {
        const id=++sequence,stream=new ReadableStream({start(controller){controllers.push({controller,id});controller.enqueue(encoder.encode('{"jsonrpc":"2.0","id":'));}});
        pending.push(run('body-holder','recipient',null,null,request(null,stream)));
      }
      try {await waitFor(()=>admission.usage.bodies===admission.limits.bodies);const excess=await run('body-rejection','recipient',message('tools/list'));denied(excess);check(excess.resolved===0,'Body rejection resolved identity');}
      finally {for(const {controller,id} of controllers){controller.enqueue(encoder.encode(id+',"method":"ping"}'));controller.close();}(await Promise.all(pending)).forEach(accepted);}
      await discovery('body-recovered-discovery');
    }
    {
      let timer,chunks=0;
      const stream=new ReadableStream({start(controller){controller.enqueue(encoder.encode('{'));timer=setInterval(()=>{chunks++;controller.enqueue(encoder.encode(' '));},750);},cancel(){clearInterval(timer);}});
      const record=await run('total-upload-deadline','recipient',null,null,request(null,stream));clearInterval(timer);
      check(record.status===408,'Trickling upload did not reach its total deadline');check(record.ms>=admission.limits.bodyTimeoutMs-250&&chunks>=2,'Upload probe did not demonstrate a total deadline despite progress');check(record.resolved===0&&record.metrics.statements===0,'Timed out upload accessed private service');
      record.progress_chunks=chunks;record.configured_total_deadline_ms=admission.limits.bodyTimeoutMs;
    }
    const observed=observer.snapshot();
    for(const [key,limit] of [['bodies',16],['tools',12],['heavyReads',2],['perAccount',3]])check(observed.peaks[key]===limit,'Incorrect observed peak '+key);
    check(Object.values(admission.usage).every(n=>n===0),'Admission leases did not fully release');
    const latencies={};
    for(const [name,status] of [['admitted_with_synthetic_gates',200],['rejected',429],['timed_out_upload',408]]){const sorted=records.filter(r=>r.status===status).map(r=>r.ms).sort((a,b)=>a-b);latencies[name]={samples:sorted.length,p50_ms:sorted[Math.max(0,Math.ceil(sorted.length*0.5)-1)]??0,p95_ms:sorted[Math.max(0,Math.ceil(sorted.length*0.95)-1)]??0};}
    return {passed:true,observed,counts:{requests:records.length,admitted:records.filter(r=>r.status===200).length,rejected:records.filter(r=>r.status===429).length,timed_out:records.filter(r=>r.status===408).length},latencies,records,notes:['Uses real default per-isolate guard; claim/release instrumentation delegates unchanged methods and limits.','Held admitted work is synthetic gating for deterministic occupancy, excluded from ordinary workload latency.','Individual burst timings run the real handler directly inside Workerd; they exclude the outer Miniflare HTTP bridge.','All rejections are retained. No server or automatic client replay.','Per-account rejection resolves fresh synthetic identity; this resolver uses no database. Zero SQL here does not claim all production identity resolvers are database-free.','Discovery succeeds under tool/account/heavy saturation. Body saturation rejects discovery promptly429, then discovery succeeds after body slots release.']};
  } catch(error) {return {passed:false,error:error.message,observed:observer.snapshot(),records};}
}

const workerSource=`
import {Workspace} from './lib/workspace.ts';
import {handleMcpPost} from './lib/mcp-http.ts';
${hasAdmission?"import {mcpAdmission} from './lib/mcp-admission.ts';":"const mcpAdmission=null;"}
import {seedAgentLoad} from './tests/helpers/agent-load.mjs';
const newMetrics=${newMetrics.toString()};
const instrumentDatabase=${instrumentDatabase.toString()};
const observeAdmission=${observeAdmission.toString()};
const runAdmissionProbe=${runAdmissionProbe.toString()};
const seedUnicodeFixture=${seedUnicodeFixture.toString()};
const admissionObserver=mcpAdmission?observeAdmission(mcpAdmission):null;
let fixture=null;
export default {async fetch(request,env) {
  const pathname=new URL(request.url).pathname;
  if(pathname==='/__seed') {
    if(fixture)return new Response('Fixture already seeded',{status:409});
    for(const sql of ${JSON.stringify(migrationSql)})await env.DB.prepare(sql).run();
    fixture=await seedAgentLoad(env.DB,${options.rows});
    return Response.json(fixture);
  }
  if(!fixture)return new Response('Seed first',{status:409});
  if(pathname==='/__admission_probe')return Response.json(await runAdmissionProbe(handleMcpPost,mcpAdmission,admissionObserver,Workspace,env.DB,fixture));
  if(pathname==='/__unicode_fixture')return Response.json(await seedUnicodeFixture(env.DB,fixture));
  if(pathname==='/__admission_observer')return Response.json(admissionObserver?.snapshot()??{available:false});
  if(pathname==='/__reset_contact') {
    await env.DB.prepare('UPDATE agents SET status=?,last_seen_at=NULL WHERE id IN (?,?)').bind('pending',fixture.sender_id,fixture.recipient_id).run();
    return new Response('Reset synthetic contact');
  }
  if(pathname==='/__verify') {
    const tasks=(await env.DB.prepare("SELECT id,status,version,request_key FROM tasks WHERE request_key LIKE 'load-%' ORDER BY request_key").all()).results;
    const updates=(await env.DB.prepare("SELECT task_id,version,request_key FROM task_updates WHERE request_key LIKE 'load-%' ORDER BY request_key").all()).results;
    const events=(await env.DB.prepare("SELECT kind,description FROM events WHERE kind IN ('instruction','feedback') AND description LIKE '%load-%'").all()).results;
    return Response.json({tasks,updates,events});
  }
  if(pathname==='/__profile_room') {
    const metrics={statements:0,round_trips:0,write_statements:0,agent_update_statements:0,agent_rows_changed:0,rows_written:0,rows_read:0,meta_results:0,trace:[]};
    const response=await handleMcpPost(new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'room-profile',method:'tools/call',params:{name:'read_space',arguments:{agent_id:fixture.recipient_id,space_id:fixture.space_id}}})}),async()=>new Workspace(instrumentDatabase(env.DB,metrics),fixture.users.recipient));
    const body=await response.json();if(response.status!==200||body.error||body.result?.isError)throw Error('Room profiler was not admitted successfully');const room=body.result.structuredContent;
    // Explain the actual final source recheck separately from its measured cost.
    metrics.final_source_lookup_plan=(await env.DB.prepare('EXPLAIN QUERY PLAN '+metrics.trace.at(-1).sql).bind(fixture.recipient_id,JSON.stringify(room.sources.map(s=>s.id)),fixture.space_id,fixture.users.recipient.id).all()).results;
    return Response.json(metrics);
  }
  if(pathname!=='/mcp')return new Response('Unknown synthetic endpoint',{status:404});
  const role=request.headers.get('x-synthetic-role'),user=fixture.users[role];
  if(!user)return new Response('Synthetic role required',{status:400});
  const metrics={statements:0,round_trips:0,write_statements:0,agent_update_statements:0,agent_rows_changed:0,rows_written:0,rows_read:0,meta_results:0};
  const response=await handleMcpPost(request,async()=>new Workspace(instrumentDatabase(env.DB,metrics),user));
  response.headers.set('x-local-workload-metrics',JSON.stringify(metrics));
  return response;
}};
`;
const compiled=await build({stdin:{contents:workerSource,resolveDir:projectRoot,sourcefile:'synthetic-agent-load-worker.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:options.revision?[{name:'committed-application-source',setup(b){b.onLoad({filter:/\/lib\/[^/]+\.ts$/},async args=>({contents:await source(path.relative(projectRoot,args.path)),loader:'ts'}));}}]:[]});
const sourceHashes={};
for(const relative of ['lib/workspace.ts','lib/mcp-http.ts','lib/host.ts',...(hasAdmission?['lib/mcp-admission.ts','lib/request-body.ts']:[])]) sourceHashes[relative]=createHash('sha256').update(await source(relative)).digest('hex');
if(options.checkOnly){await rm(root,{recursive:true,force:true});console.log('Local Worker bundle compiled. No runtime, database, or workload started.');process.exit(0);}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??0;};
const summary=records=>({requests:records.length,p50_ms:percentile(records.map(r=>r.ms),0.5),p95_ms:percentile(records.map(r=>r.ms),0.95),payload_p50_bytes:percentile(records.map(r=>r.bytes),0.5),payload_p95_bytes:percentile(records.map(r=>r.bytes),0.95),statements:records.reduce((n,r)=>n+r.metrics.statements,0),statements_p50:percentile(records.map(r=>r.metrics.statements),0.5),statements_p95:percentile(records.map(r=>r.metrics.statements),0.95),round_trips:records.reduce((n,r)=>n+r.metrics.round_trips,0),write_statements:records.reduce((n,r)=>n+r.metrics.write_statements,0),agent_update_statements:records.reduce((n,r)=>n+r.metrics.agent_update_statements,0),agent_rows_changed:records.reduce((n,r)=>n+r.metrics.agent_rows_changed,0),observed_rows_read:records.reduce((n,r)=>n+r.metrics.rows_read,0),rows_read_p50:percentile(records.map(r=>r.metrics.rows_read),0.5),rows_read_p95:percentile(records.map(r=>r.metrics.rows_read),0.95),observed_rows_written:records.reduce((n,r)=>n+r.metrics.rows_written,0)});
const deadline=setTimeout(()=>{console.error('Local workload exceeded 180 second emergency deadline; no remote fallback. Scratch may remain at '+root);process.exit(2);},180000);
let mf,admissionProbe=null,unicodeProbe=null;
const observedRecords=[];
try {
  // Fail clearly in a restricted sandbox, before Miniflare's listener can stall.
  await new Promise((resolve,reject)=>{const probe=http.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>probe.close(resolve));});
  mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,cf:false,compatibilityDate:'2026-05-15',d1Databases:{DB:'accord-synthetic-workload'},d1Persist:path.join(root,'d1'),host:'127.0.0.1',port:0,outboundService:()=>new Response('External requests disabled',{status:403}),log:new Log(LogLevel.WARN)});
  const local=pathname=>mf.dispatchFetch('http://127.0.0.1'+pathname);
  const seedResponse=await local('/__seed');assert.equal(seedResponse.status,200,await seedResponse.clone().text());const f=await seedResponse.json();
  let sequence=0,active=0,peak=0,cap=1,queue=[],heavyActive=0,heavyQueue=[];
  const acquire=async()=>{if(active>=cap)await new Promise(resolve=>queue.push(resolve));else active++;peak=Math.max(peak,active);};
  const release=()=>{if(queue.length)queue.shift()();else active--;};
  const acquireHeavy=async()=>{if(heavyActive>=options.clientHeavyCap)await new Promise(resolve=>heavyQueue.push(resolve));else heavyActive++;};
  const releaseHeavy=()=>{if(heavyQueue.length)heavyQueue.shift()();else heavyActive--;};
  const heavyRead=(name,args)=>['read_context','read_task','read_context_change','list_spaces','list_sessions'].includes(name)||name==='read_inbox'&&args.projection!=='summary';
  const invoke=async(role,name,args,records,label=records?'admitted-workload':'preflight')=>{
    const heavy=heavyRead(name,args);if(heavy)await acquireHeavy();
    await acquire();
    let captured=false,capturedRecord=null;const start=performance.now();
    try {
      const id=++sequence;
      const response=await mf.dispatchFetch('http://127.0.0.1/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','x-synthetic-role':role},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})});
      const text=await response.text(),ms=performance.now()-start;let body=null;try{body=JSON.parse(text);}catch{/* Retain malformed responses before the assertion. */}
      const record={name,label,status:response.status,outcome:response.status===429?'rejected':response.status===200&&body&&!body.error&&!body.result?.isError?'admitted':'failed',ms,bytes:Buffer.byteLength(text),retry_after:response.headers.get('Retry-After'),cache_control:response.headers.get('Cache-Control'),metrics:JSON.parse(response.headers.get('x-local-workload-metrics')),error:body?.error??(body?.result?.isError?body.result.content:body===null?'Malformed JSON':null)};
      records?.push(record);observedRecords.push(record);captured=true;capturedRecord=record;
      assert.ok(body,'Malformed JSON response');
      assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.error,undefined,JSON.stringify(body));assert.equal(body.result?.isError,undefined,JSON.stringify(body));assert.equal(body.id,id);
      assert.deepEqual(JSON.parse(body.result.content[0].text),body.result.structuredContent);
      return body.result.structuredContent;
    } catch(error) {
      if(!captured){const record={name,label,status:0,outcome:'failed',ms:performance.now()-start,bytes:0,metrics:null,error:error.message};records?.push(record);observedRecords.push(record);}
      else if(capturedRecord.outcome==='admitted'){capturedRecord.outcome='failed';capturedRecord.error=error.message;}
      throw error;
    } finally {release();if(heavy)releaseHeavy();}
  };
  const args={agent_id:f.recipient_id};
  // Omit projection for full mode, preserving requests to historical revisions.
  const inboxInput=options.inboxProjection==='summary'?{projection:'summary'}:{};
  const assertInbox=value=>{
    assert.ok(value.instructions.length<=100);
    if(options.inboxProjection==='summary') {
      assert.equal(value.projection,'summary');
      const keys=['id','space_id','grant_id','from_agent','to_agent','title','status','version','scope','channel','created_at','updated_at','from_name','to_name','body_preview','body_characters','feedback_available'].sort();
      for(const item of value.instructions) {
        assert.deepEqual(Object.keys(item).sort(),keys,'Unexpected inbox summary shape');
        assert.equal(Object.hasOwn(item,'body'),false);assert.equal(Object.hasOwn(item,'feedback'),false);
        assert.equal(typeof item.body_preview,'string');assert.ok([...item.body_preview].length<=300);
        assert.ok(Number.isSafeInteger(item.body_characters)&&item.body_characters>=[...item.body_preview].length);
        assert.equal(typeof item.feedback_available,'boolean');assert.ok(Number.isSafeInteger(item.version)&&item.version>=0);
        for(const key of ['id','space_id','grant_id','from_agent','to_agent','title','scope','channel','from_name','to_name'])assert.equal(typeof item[key],'string');
        assert.ok(['queued','working','needs_input'].includes(item.status));
      }
    } else for(const item of value.instructions){assert.equal(typeof item.body,'string');assert.equal(typeof item.feedback,'string');}
  };
  // Full cursor walks before writes establish exact fixture counts and unique IDs.
  const walk=async(name,key,expected,extra={})=>{
    const seen=new Set();let cursor=null;
    do {const result=await invoke('recipient',name,{...args,...extra,limit:17,...(cursor?{cursor}:{})});assert.ok(result[key].length<=17);if(name==='read_inbox')assertInbox(result);for(const row of result[key]){assert.ok(!seen.has(row.id),'Repeated pagination ID');seen.add(row.id);}cursor=result.next_cursor;}while(cursor);
    assert.equal(seen.size,expected,`Unexpected ${name} count`);
  };
  let inboxDetailProbe=null;
  if(!options.contactOnly){
    await walk('read_inbox','instructions',f.queued,inboxInput);await walk('read_context','context',f.accepted);await walk('read_space_section','items',f.rows,{space_id:f.space_id,section:'sources'});
    // Exact record checks are intentionally outside the measured request samples.
    const inbox=await invoke('recipient','read_inbox',{...args,...inboxInput,limit:1});assertInbox(inbox);
    const selected=inbox.instructions[0];assert.equal(selected.id,'workload-task-000000');
    const detail=await invoke('recipient','read_task',{...args,task_id:selected.id});
    assert.equal(detail.task.id,selected.id);assert.equal(detail.task.title,selected.title);assert.equal(detail.task.version,selected.version);
    assert.equal(detail.task.body,'b'.repeat(8000));assert.equal(detail.task.feedback,'');
    if(options.inboxProjection==='summary'){assert.equal(selected.body_preview,'b'.repeat(300));assert.equal(selected.body_characters,8000);assert.equal(selected.feedback_available,false);}
    let savedFeedbackComplete=null;
    if(f.rows>1){const closed=await invoke('recipient','read_task',{...args,task_id:'workload-task-000001'});assert.equal(closed.task.body,'b'.repeat(8000));assert.equal(closed.task.feedback,'f'.repeat(8000));assert.equal(closed.updates[0].feedback,'f'.repeat(8000));savedFeedbackComplete=true;}
    inboxDetailProbe={projection:options.inboxProjection,complete_body:true,body_characters:8000,saved_feedback_complete:savedFeedbackComplete,note:'Preflight checks only; excluded from measurement samples.'};
  }
  await local('/__reset_contact');
  const contact=[];
  for(let i=0;i<10;i++)await invoke('recipient','read_context',{...args,limit:1},contact,'contact');
  const roomQueryProbe=options.contactOnly?null:await(await local('/__profile_room')).json();
  const scenarios=[];
  if(!options.contactOnly)for(const concurrency of options.concurrency) {
    cap=concurrency;peak=0;const records=[],jobs=[],receipts=[];let pipelines=0;
    const pipeline=async()=>{
      const key='load-'+concurrency+'-'+pipelines++,title='Synthetic '+key;
      const send={agent_id:f.sender_id,grant_id:f.grant_id,title,body:'Synthetic retry probe '+key,request_id:key};
      const [a,b]=await Promise.all([invoke('sender','send_instruction',send,records),invoke('sender','send_instruction',send,records)]);assert.deepEqual(a,b);
      const report={agent_id:f.recipient_id,task_id:a.id,expected_version:0,status:'completed',feedback:'Synthetic completion '+key,request_id:key+'-report'};
      const [c,d]=await Promise.all([invoke('recipient','report_progress',report,records),invoke('recipient','report_progress',report,records)]);assert.deepEqual(c,d);assert.equal(c.version,1);assert.equal(c.status,'completed');receipts.push({key,task_id:a.id,update_id:c.update_id});
    };
    const start=performance.now();
    for(let i=0;i<Math.max(options.reads,options.writes);i++) {
      if(i<options.reads){const name=['read_inbox','read_context','read_space'][i%3];const input=name==='read_space'?{...args,space_id:f.space_id}:{...args,limit:20,...(name==='read_inbox'?inboxInput:{})};jobs.push(invoke('recipient',name,input,records).then(value=>{
        if(name==='read_inbox'){assert.ok(value.instructions.length<=20);assertInbox(value);}
        if(name==='read_context')assert.equal(value.context.length,Math.min(20,f.accepted));
        if(name==='read_space'){assert.equal(value.summaries,true);for(const collection of ['people','agents','grants','sources','tasks','changes','events'])assert.ok(value[collection].length<=20);assert.ok(value.sources.every(s=>s.content===undefined));assert.ok(value.tasks.every(t=>t.body===undefined));}
      }));}
      if(i<options.writes)jobs.push(pipeline());
    }
    await Promise.all(jobs);
    const elapsed=performance.now()-start,verification=await(await local('/__verify')).json();
    for(const receipt of receipts){assert.equal(verification.tasks.filter(t=>t.request_key===receipt.key).length,1);assert.equal(verification.updates.filter(t=>t.task_id===receipt.task_id).length,1);assert.equal(verification.events.filter(e=>e.kind==='instruction'&&e.description.includes('“Synthetic '+receipt.key+'”')).length,1);assert.equal(verification.events.filter(e=>e.kind==='feedback'&&e.description.includes('“Synthetic '+receipt.key+'”')).length,1);}
    const groups=Object.fromEntries([...new Set(records.map(r=>r.name))].map(name=>[name,summary(records.filter(r=>r.name===name))]));
    const scenario={concurrency,client_heavy_cap:options.clientHeavyCap,peak_inflight_requests:peak,elapsed_ms:elapsed,requests_per_second:records.length/(elapsed/1000),...summary(records),request_outcomes:{admitted:records.filter(r=>r.outcome==='admitted').length,rejected:records.filter(r=>r.outcome==='rejected').length,failed:records.filter(r=>r.outcome==='failed').length},operations:groups,correctness:{unique_sends:receipts.length,unique_reports:receipts.length,duplicate_receipts_equal:true,one_event_per_write:true},records};scenarios.push(scenario);
    console.log(JSON.stringify({concurrency,peak_inflight_requests:peak,elapsed_ms:Math.round(elapsed),requests:records.length,p50_ms:scenario.p50_ms,p95_ms:scenario.p95_ms,operations:groups}));
  }
  if(!options.contactOnly&&hasAdmission) {
    const response=await local('/__admission_probe');admissionProbe=await response.json();
    assert.equal(admissionProbe.passed,true,JSON.stringify(admissionProbe));
  }
  if(!options.contactOnly&&hasByteBounds) {
    cap=1;
    const response=await local('/__unicode_fixture');assert.equal(response.status,200);const fixture=await response.json();
    const text={body:'界'.repeat(8000),feedback:'語'.repeat(8000),adopted:'指'.repeat(5000),reason:'由'.repeat(3000),previous:'旧'.repeat(5000),instruction:'新'.repeat(5000),note:'記'.repeat(2000)};
    const traversals={};
    const traverse=async(name,key,extra,validate)=>{
      const seen=new Set(),cursors=new Set(),records=[],pageCounts=[];let cursor=null;
      do {
        const result=await invoke('recipient',name,{agent_id:fixture.agent_id,limit:100,...extra,...(cursor?{cursor}:{})},records,'unicode-pages');
        assert.ok(records.at(-1).bytes<=1024*1024,'Standard field maximum response exceeded1MiB');assert.notEqual(result.oversized_record,true,'Standard field maximum was treated as intrinsically oversized');
        assert.ok(result[key].length<=100);pageCounts.push(result[key].length);
        for(const item of result[key]){assert.ok(!seen.has(item.id),'Repeated Unicode cursor record');seen.add(item.id);validate(item,result);}
        if(name==='read_task'){assert.equal(result.task.body,text.body);assert.equal(result.task.feedback,text.feedback);assert.equal(result.task.version,100);}
        if(name==='read_context_change'){assert.equal(result.current.previous,text.previous);assert.equal(result.current.instruction,text.instruction);assert.equal(result.current.adopted,text.adopted);assert.equal(result.current.reason,text.reason);assert.equal(result.current.version,100);}
        cursor=result.next_cursor;if(cursor){assert.ok(!cursors.has(cursor),'Repeated Unicode page cursor');cursors.add(cursor);assert.ok(result[key].length>0,'Empty Unicode page with more records');}
      }while(cursor);
      assert.equal(seen.size,100,'Unicode traversal did not preserve all100 complete records');
      return {complete_records:seen.size,pages:records.length,items_per_page:pageCounts,max_response_bytes:Math.max(...records.map(r=>r.bytes)),...summary(records),records};
    };
    traversals.inbox=await traverse('read_inbox','instructions',{projection:'full'},item=>{assert.equal(item.body,text.body);assert.equal(item.feedback,text.feedback);});
    traversals.context=await traverse('read_context','context',{},item=>{assert.equal(item.instruction,text.adopted);assert.equal(item.reason,text.reason);});
    traversals.task_history=await traverse('read_task','updates',{task_id:'unicode-task-000'},item=>{assert.equal(item.feedback,text.feedback);});
    traversals.decision_history=await traverse('read_context_change','history',{change_id:'unicode-change-000'},item=>{assert.equal(item.adopted,text.adopted);assert.equal(item.note,text.note);});
    unicodeProbe={passed:true,fixture,traversals,maximum_response_bytes:1024*1024,complete_untruncated_details:true,note:'Separate recipient and data added after timed workloads. All standard maximum CJK fields, exact details and histories tested outside ordinary latency measurements.'};
  }
  const admissionObserved=hasAdmission?await(await local('/__admission_observer')).json():{available:false};
  const report={kind:'non-production-local-agent-workload',created_at:new Date().toISOString(),revision,source_mode:options.revision?'committed revision':'working tree',source_hashes:sourceHashes,compiled_worker_sha256:createHash('sha256').update(compiled.outputFiles[0].text).digest('hex'),environment:{node:process.version,miniflare:JSON.parse(await readFile(path.join(projectRoot,'node_modules/miniflare/package.json'),'utf8')).version,backend:'Miniflare workerd with local D1',binding:'fresh synthetic-only DB',external_worker_fetch:'disabled',migrations:migrations.length},configuration:options,fixture:{rows_per_collection:f.rows,members:f.rows+2,agents:f.rows+2,sources:f.rows,tasks:f.rows,changes:f.rows,grants:f.rows+1,accepted_context:f.accepted,actionable_inbox:f.queued,source_content_characters:19900+'Synthetic source 000000 '.length,task_body_characters:8000,adopted_context_characters:5000},contact_probe:{description:'10 sequential real MCP read_context calls, limit=1, synthetic contact initially pending with last_seen_at null',...summary(contact),records:contact},room_query_probe:roomQueryProbe,inbox_detail_probe:inboxDetailProbe,admission_probe:admissionProbe,unicode_page_probe:unicodeProbe,admission_observed:admissionObserved,selected_source_capabilities:{admission:hasAdmission,byte_bounded_pages:hasByteBounds},request_outcomes:{admitted:observedRecords.filter(r=>r.outcome==='admitted').length,rejected:observedRecords.filter(r=>r.outcome==='rejected').length,failed:observedRecords.filter(r=>r.outcome==='failed').length},scenarios,limitations:['Local timings include asynchronous Miniflare dispatchFetch bridge and response serialization. They do not establish production capacity.','No production traffic, identities, tokens, deployment, or remote bindings. Worker external fetches are rejected.','Successful runs dispose local runtimes and remove scratch storage. Emergency workload/disposal deadlines terminate the process and may leave synthetic scratch storage; its path is printed.','Auth is replaced by an explicit synthetic-only role selector in this isolated harness. Production auth, edge network, cold starts, billing, remote D1 quotas, and geographic replication are unmeasured.','Query counts are exact application statement executions. round_trips count binding calls and batch submissions, not production network hops.','To expose actual D1 metadata, the instrumentation executes first() SQL with all() and projects the first row. This preserves the tested Workspace calls but includes all() result materialization in timings.','Payload bytes count the complete JSON-RPC response body; MCP text plus structuredContent duplicate record data.','Runs use one local D1 database; later scenarios include completed synthetic writes from earlier scenarios.','Ordinary admitted workload uses a local caller queue, global concurrency1/2 and client heavy cap2; latency excludes both caller queues and includes the full response body read. Server admission is exercised unchanged. Overload samples and their latency are reported separately; no rejected or failed response is silently dropped or retried. Percentiles use nearest rank; ten-request contact p95 is its maximum and includes its first request.'],correctness:{pagination:options.contactOnly?'Skipped for contact-only probe':'Complete unique cursor walks match seeded actionable inbox, accepted context, and sources',mcp_text_matches_structured_content:true},output};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,contact_probe:summary(contact)}));
} catch(error) {
  await writeFile(output,JSON.stringify({kind:'non-production-local-agent-workload-failed',created_at:new Date().toISOString(),revision,source_hashes:sourceHashes,configuration:options,error:error.message,request_samples:observedRecords,admission_probe:admissionProbe,unicode_page_probe:unicodeProbe,note:'Failed and rejected samples retained. No automatic retry, remote fallback or production traffic.'},null,2)+'\n');
  if(error?.code==='EPERM')console.error('Local loopback listening is blocked by the sandbox. Run this same synthetic-only script with local listener permission; it never falls back to remote D1.');
  throw error;
} finally {
  clearTimeout(deadline);
  const cleanupGuard=setTimeout(()=>{console.error('Local runtime disposal exceeded 15 seconds. Scratch may remain at '+root);process.exit(2);},15000);
  try {if(mf)await mf.dispose();await rm(root,{recursive:true,force:true});}
  finally {clearTimeout(cleanupGuard);}
}
