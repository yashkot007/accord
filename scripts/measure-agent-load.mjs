#!/usr/bin/env node
// NON-PRODUCTION: real Worker/MCP code, fresh local D1, synthetic identities only.
// Run: node scripts/measure-agent-load.mjs --rows=250 --concurrency=1,8,24
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
const options={rows:250,reads:60,writes:8,concurrency:[1,8,24],revision:null,output:null,contactOnly:false,inboxProjection:'full'};
for (const arg of process.argv.slice(2)) {
  if (arg==='--help') {
    console.log('Isolated local Worker/D1 measurement; never a production capacity claim.\nOptions: --rows=250 --reads=60 --writes=8 --concurrency=1,8,24 --inbox-projection=summary|full (default full) --revision=<git-ref> --contact-only --output=/private/tmp/report.json');
    process.exit(0);
  }
  if (arg==='--contact-only') {options.contactOnly=true;continue;}
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
const migrations=options.revision?git('ls-tree','-r','--name-only',revision,'drizzle').split('\n').filter(f=>/^drizzle\/[^/]+\.sql$/.test(f)).sort():(await readdir(path.join(projectRoot,'drizzle'))).filter(f=>f.endsWith('.sql')).sort().map(f=>'drizzle/'+f);
const migrationSql=[];
for(const migration of migrations) migrationSql.push(...(await source(migration)).split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean));

function instrumentDatabase(db,metrics) {
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
    async first(column){count(sql);const result=meta(await statement.all(),sql);const row=result.results?.[0]??null;return column===undefined?row:row?.[column]??null;},
    async all(...args){count(sql);return meta(await statement.all(...args),sql);},
    async run(...args){count(sql);return meta(await statement.run(...args),sql);},
  });
  return {
    prepare(sql){return wrap(sql,db.prepare(sql));},
    async batch(statements){metrics.round_trips++;for(const s of statements)count(s.sql,false);const results=await db.batch(statements.map(s=>s.statement));results.forEach((result,i)=>meta(result,statements[i].sql));return results;},
  };
}

const workerSource=`
import {Workspace} from './lib/workspace.ts';
import {handleMcpPost} from './lib/mcp-http.ts';
import {seedAgentLoad} from './tests/helpers/agent-load.mjs';
const instrumentDatabase=${instrumentDatabase.toString()};
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
    const room=await new Workspace(instrumentDatabase(env.DB,metrics),fixture.users.recipient).agentTool('read_space',{agent_id:fixture.recipient_id,space_id:fixture.space_id});
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
for(const relative of ['lib/workspace.ts','lib/mcp-http.ts','lib/host.ts']) sourceHashes[relative]=createHash('sha256').update(await source(relative)).digest('hex');
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??0;};
const summary=records=>({requests:records.length,p50_ms:percentile(records.map(r=>r.ms),0.5),p95_ms:percentile(records.map(r=>r.ms),0.95),payload_p50_bytes:percentile(records.map(r=>r.bytes),0.5),payload_p95_bytes:percentile(records.map(r=>r.bytes),0.95),statements:records.reduce((n,r)=>n+r.metrics.statements,0),statements_p50:percentile(records.map(r=>r.metrics.statements),0.5),statements_p95:percentile(records.map(r=>r.metrics.statements),0.95),round_trips:records.reduce((n,r)=>n+r.metrics.round_trips,0),write_statements:records.reduce((n,r)=>n+r.metrics.write_statements,0),agent_update_statements:records.reduce((n,r)=>n+r.metrics.agent_update_statements,0),agent_rows_changed:records.reduce((n,r)=>n+r.metrics.agent_rows_changed,0),observed_rows_read:records.reduce((n,r)=>n+r.metrics.rows_read,0),rows_read_p50:percentile(records.map(r=>r.metrics.rows_read),0.5),rows_read_p95:percentile(records.map(r=>r.metrics.rows_read),0.95),observed_rows_written:records.reduce((n,r)=>n+r.metrics.rows_written,0)});
const deadline=setTimeout(()=>{console.error('Local workload exceeded 180 second emergency deadline; no remote fallback. Scratch may remain at '+root);process.exit(2);},180000);
let mf;
try {
  // Fail clearly in a restricted sandbox, before Miniflare's listener can stall.
  await new Promise((resolve,reject)=>{const probe=http.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>probe.close(resolve));});
  mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,cf:false,compatibilityDate:'2026-05-15',d1Databases:{DB:'accord-synthetic-workload'},d1Persist:path.join(root,'d1'),host:'127.0.0.1',port:0,outboundService:()=>new Response('External requests disabled',{status:403}),log:new Log(LogLevel.WARN)});
  const local=pathname=>mf.dispatchFetch('http://127.0.0.1'+pathname);
  const seedResponse=await local('/__seed');assert.equal(seedResponse.status,200,await seedResponse.clone().text());const f=await seedResponse.json();
  let sequence=0,active=0,peak=0,cap=1,queue=[];
  const acquire=async()=>{if(active>=cap)await new Promise(resolve=>queue.push(resolve));else active++;peak=Math.max(peak,active);};
  const release=()=>{if(queue.length)queue.shift()();else active--;};
  const invoke=async(role,name,args,records)=>{
    await acquire();
    try {
      const start=performance.now(),id=++sequence;
      const response=await mf.dispatchFetch('http://127.0.0.1/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','x-synthetic-role':role},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})});
      const text=await response.text(),ms=performance.now()-start,body=JSON.parse(text);
      assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.error,undefined,JSON.stringify(body));assert.equal(body.result?.isError,undefined,JSON.stringify(body));assert.equal(body.id,id);
      assert.deepEqual(JSON.parse(body.result.content[0].text),body.result.structuredContent);
      const record={name,ms,bytes:Buffer.byteLength(text),metrics:JSON.parse(response.headers.get('x-local-workload-metrics'))};
      records?.push(record);return body.result.structuredContent;
    } finally {release();}
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
  for(let i=0;i<10;i++)await invoke('recipient','read_context',{...args,limit:1},contact);
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
    const scenario={concurrency,peak_inflight_requests:peak,elapsed_ms:elapsed,requests_per_second:records.length/(elapsed/1000),...summary(records),operations:groups,correctness:{unique_sends:receipts.length,unique_reports:receipts.length,duplicate_receipts_equal:true,one_event_per_write:true},records};scenarios.push(scenario);
    console.log(JSON.stringify({concurrency,peak_inflight_requests:peak,elapsed_ms:Math.round(elapsed),requests:records.length,p50_ms:scenario.p50_ms,p95_ms:scenario.p95_ms,operations:groups}));
  }
  const report={kind:'non-production-local-agent-workload',created_at:new Date().toISOString(),revision,source_mode:options.revision?'committed revision':'working tree',source_hashes:sourceHashes,compiled_worker_sha256:createHash('sha256').update(compiled.outputFiles[0].text).digest('hex'),environment:{node:process.version,miniflare:JSON.parse(await readFile(path.join(projectRoot,'node_modules/miniflare/package.json'),'utf8')).version,backend:'Miniflare workerd with local D1',binding:'fresh synthetic-only DB',external_worker_fetch:'disabled',migrations:migrations.length},configuration:options,fixture:{rows_per_collection:f.rows,members:f.rows+2,agents:f.rows+2,sources:f.rows,tasks:f.rows,changes:f.rows,grants:f.rows+1,accepted_context:f.accepted,actionable_inbox:f.queued,source_content_characters:19900+'Synthetic source 000000 '.length,task_body_characters:8000,adopted_context_characters:5000},contact_probe:{description:'10 sequential real MCP read_context calls, limit=1, synthetic contact initially pending with last_seen_at null',...summary(contact),records:contact},room_query_probe:roomQueryProbe,inbox_detail_probe:inboxDetailProbe,scenarios,limitations:['Local timings include asynchronous Miniflare dispatchFetch bridge and response serialization. They do not establish production capacity.','No production traffic, identities, tokens, deployment, or remote bindings. Worker external fetches are rejected.','Successful runs dispose local runtimes and remove scratch storage. Emergency workload/disposal deadlines terminate the process and may leave synthetic scratch storage; its path is printed.','Auth is replaced by an explicit synthetic-only role selector in this isolated harness. Production auth, edge network, cold starts, billing, remote D1 quotas, and geographic replication are unmeasured.','Query counts are exact application statement executions. round_trips count binding calls and batch submissions, not production network hops.','To expose actual D1 metadata, the instrumentation executes first() SQL with all() and projects the first row. This preserves the tested Workspace calls but includes all() result materialization in timings.','Payload bytes count the complete JSON-RPC response body; MCP text plus structuredContent duplicate record data.','Runs use one local D1 database; later scenarios include completed synthetic writes from earlier scenarios.','Latency starts after admission by the local concurrency limiter, excludes time waiting in its queue, and includes the full response body read. Percentiles use nearest rank; ten-request contact p95 is its maximum and includes its first request.'],correctness:{pagination:options.contactOnly?'Skipped for contact-only probe':'Complete unique cursor walks match seeded actionable inbox, accepted context, and sources',mcp_text_matches_structured_content:true},output};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,contact_probe:summary(contact)}));
} catch(error) {
  if(error?.code==='EPERM')console.error('Local loopback listening is blocked by the sandbox. Run this same synthetic-only script with local listener permission; it never falls back to remote D1.');
  throw error;
} finally {
  clearTimeout(deadline);
  const cleanupGuard=setTimeout(()=>{console.error('Local runtime disposal exceeded 15 seconds. Scratch may remain at '+root);process.exit(2);},15000);
  try {if(mf)await mf.dispose();await rm(root,{recursive:true,force:true});}
  finally {clearTimeout(cleanupGuard);}
}
