import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,pair} from './helpers/workspace.mjs';
import {handleMcpPost} from '../lib/mcp-http.ts';

async function task(f){return f.a.human('send_instruction',{grant_id:f.grant.id,title:'Trace the handoff',body:'Explain the evidence and remaining question.'});}
const report=(id,version,status='working',key='report-'+version)=>({task_id:id,expected_version:version,request_id:key,status,feedback:'Evidence at version '+version});
const count=(db,table)=>Number(db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

test('progress appends attributable reports, projects latest state, and recovers old receipts',async()=>{
  const f=await pair(),t=await task(f);
  const first=await f.b.human('report_progress',report(t.id,0));
  const secondArgs={...report(t.id,1,'needs_input'),agent_id:f.recipient.id};
  const second=await f.b.agentTool('report_progress',secondArgs);
  const last=await f.b.human('report_progress',report(t.id,2,'completed'));
  const history=await f.a.agentTool('read_task',{task_id:t.id,agent_id:f.sender.id});
  assert.deepEqual(history.updates.map(u=>u.version),[1,2,3]);
  assert.deepEqual(history.updates.map(u=>u.channel),['human','agent','human']);
  assert.equal(history.updates[0].actor_id,f.b.user.id);assert.equal(history.updates[0].agent_id,null);
  assert.equal(history.updates[1].agent_id,f.recipient.id);assert.equal(history.updates[1].actor_name,'Recipient');
  assert.equal(history.task.version,3);assert.equal(history.task.feedback,'Evidence at version 2');assert.equal(history.task.can_report,0);
  assert.deepEqual(await f.b.human('report_progress',report(t.id,0)),first);
  assert.deepEqual(await f.b.agentTool('report_progress',secondArgs),second);
  assert.deepEqual(await f.b.human('report_progress',report(t.id,2,'completed')),last);
  assert.equal(count(f.db,'task_updates'),3);
  await assert.rejects(f.b.human('report_progress',report(t.id,3)),e=>e.status===409);
  await assert.rejects(f.b.human('report_progress',{...report(t.id,0),feedback:'Changed'}),e=>e.status===409);
  await assert.rejects(f.b.human('report_progress',{...report(t.id,0),expected_version:3}),e=>e.status===409);
  f.db.sqlite.close();
});

test('competing identical reports recover one receipt; competing new reports cannot overwrite',async()=>{
  const f=await pair(),t=await task(f),args=report(t.id,0),batch=f.db.batch.bind(f.db);
  let winner;
  f.db.batch=async statements=>{f.db.batch=batch;winner=await f.b.human('report_progress',args);return batch(statements);};
  const recovered=await f.b.human('report_progress',args);assert.deepEqual(recovered,winner);
  assert.equal(count(f.db,'task_updates'),1);assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM events WHERE kind='feedback'").get().n,1);
  f.db.batch=async statements=>{f.db.batch=batch;await f.b.human('report_progress',{...report(t.id,1,'needs_input','winner'),feedback:'Current question'});return batch(statements);};
  await assert.rejects(f.b.human('report_progress',report(t.id,1,'working','loser')),e=>e.status===409);
  const saved=await f.b.readTask({task_id:t.id});assert.equal(saved.task.feedback,'Current question');assert.equal(saved.updates.length,2);
  f.db.sqlite.close();
});

for(const mutation of ['grant','expiry','recipient','sender-member','recipient-attachment'])test(`progress commit rechecks ${mutation} without writing partial history`,async()=>{
  const f=await pair(),t=await task(f),batch=f.db.batch.bind(f.db),events=count(f.db,'events');
  f.db.batch=async statements=>{
    f.db.batch=batch;
    if(mutation==='grant')f.db.sqlite.prepare("UPDATE grants SET status='revoked' WHERE id=?").run(f.grant.id);
    if(mutation==='expiry')f.db.sqlite.prepare("UPDATE grants SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(f.grant.id);
    if(mutation==='recipient')f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id);
    if(mutation==='sender-member')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);
    if(mutation==='recipient-attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
    return batch(statements);
  };
  await assert.rejects(f.b.human('report_progress',report(t.id,0)),e=>e.status===409);
  assert.equal(count(f.db,'task_updates'),0);assert.equal(count(f.db,'events'),events);assert.equal(f.db.sqlite.prepare('SELECT version FROM tasks WHERE id=?').get(t.id).version,0);
  f.db.sqlite.close();
});

test('history pages use versions and recheck the profile and membership; receipts grant no write authority',async()=>{
  const f=await pair(),t=await task(f);
  for(let i=0;i<43;i++)await f.b.human('report_progress',report(t.id,i));
  f.db.sqlite.prepare("UPDATE task_updates SET created_at='2026-01-01T00:00:00.000Z'").run();
  let cursor,all=[];
  do{const p=await f.b.agentTool('read_task',{task_id:t.id,agent_id:f.recipient.id,limit:10,cursor});all.push(...p.updates);cursor=p.next_cursor;}while(cursor);
  assert.deepEqual(all.map(u=>u.version),Array.from({length:43},(_,i)=>i+1));
  const page=await f.b.agentTool('read_task',{task_id:t.id,agent_id:f.recipient.id,limit:10});
  const other=await task(f);await assert.rejects(f.b.agentTool('read_task',{task_id:other.id,agent_id:f.recipient.id,cursor:page.next_cursor}));
  await assert.rejects(f.a.agentTool('read_task',{task_id:t.id,agent_id:f.recipient.id}));
  await assert.rejects(f.outsider.readTask({task_id:t.id}));
  const detached=await f.b.human('add_agent',{name:'Detached',provider:'Test'});await assert.rejects(f.b.agentTool('read_task',{task_id:t.id,agent_id:detached.id}));
  await f.b.human('revoke_authority',{grant_id:f.grant.id});
  assert.equal((await f.b.readTask({task_id:t.id})).task.can_report,0);
  assert.equal((await f.b.human('report_progress',report(t.id,0))).version,1);
  await assert.rejects(f.b.human('report_progress',report(t.id,43)));
  f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
  await assert.rejects(f.b.agentTool('read_task',{task_id:t.id,agent_id:f.recipient.id,cursor:page.next_cursor}));
  f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
  await assert.rejects(f.b.readTask({task_id:t.id}));await assert.rejects(f.b.human('report_progress',report(t.id,0)));
  f.db.sqlite.close();
});

test('a failed history append rolls back the projection, legacy snapshot and event',async()=>{
  const f=await pair(),t=await task(f);f.db.sqlite.prepare("UPDATE tasks SET feedback='Older surviving feedback',status='working' WHERE id=?").run(t.id);
  f.db.sqlite.exec("CREATE TRIGGER fail_report BEFORE INSERT ON task_updates WHEN NEW.version>0 BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  const events=count(f.db,'events');await assert.rejects(f.b.human('report_progress',report(t.id,0)));
  const saved=f.db.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(t.id);assert.equal(saved.version,0);assert.equal(saved.feedback,'Older surviving feedback');
  assert.equal(count(f.db,'task_updates'),0);assert.equal(count(f.db,'events'),events);
  f.db.sqlite.close();
});

test('additive migration preserves legacy feedback without invented reporting provenance',async()=>{
  const db=database({through:'0002_true_domino.sql'});
  // Independent source-state fields are required by the current workspace service.
  db.sqlite.exec(readFileSync(new URL('../drizzle/0004_skinny_colossus.sql',import.meta.url),'utf8'));
  db.sqlite.exec(readFileSync(new URL('../drizzle/0006_melted_exodus.sql',import.meta.url),'utf8'));
  db.sqlite.exec(readFileSync(new URL('../drizzle/0007_tiny_sabra.sql',import.meta.url),'utf8'));
  db.sqlite.exec(readFileSync(new URL('../drizzle/0008_complex_spencer_smythe.sql',import.meta.url),'utf8'));
  const f=await pair(db),t=await task(f);
  db.sqlite.prepare("UPDATE tasks SET feedback='Surviving earlier report',status='working' WHERE id=?").run(t.id);
  db.sqlite.exec(readFileSync(new URL('../drizzle/0003_worried_shaman.sql',import.meta.url),'utf8'));
  let history=await f.b.readTask({task_id:t.id});assert.equal(history.task.version,0);assert.equal(history.updates.length,1);assert.equal(history.updates[0].channel,'legacy');assert.equal(history.updates[0].actor_id,null);
  await f.b.human('report_progress',report(t.id,0));history=await f.b.readTask({task_id:t.id,limit:1});
  assert.equal(history.updates[0].feedback,'Surviving earlier report');assert.ok(history.next_cursor);
  const next=await f.b.readTask({task_id:t.id,cursor:history.next_cursor,limit:1});assert.equal(next.updates[0].version,1);assert.equal(next.next_cursor,null);
  assert.equal(count(db,'task_updates'),2);db.sqlite.close();
});

test('actual MCP handler exposes history and requires a version and request key for reporting',async()=>{
  const f=await pair(),t=await task(f);let id=0;
  const call=async(name,args)=>{const request=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});return(await(await handleMcpPost(request,async()=>f.b)).json()).result;};
  const missing=await call('report_progress',{agent_id:f.recipient.id,task_id:t.id,status:'working',feedback:'No reviewed version'});assert.equal(missing.isError,true);assert.equal(count(f.db,'task_updates'),0);
  const args={...report(t.id,0,'completed'),agent_id:f.recipient.id},first=await call('report_progress',args),again=await call('report_progress',args);assert.deepEqual(first,again);
  const history=await call('read_task',{task_id:t.id,agent_id:f.recipient.id});assert.equal(history.structuredContent.task.status,'completed');assert.equal(history.structuredContent.updates.length,1);
  f.db.sqlite.close();
});


test('a concurrent report cannot produce mismatched task and history versions',async()=>{
  const f=await pair(),t=await task(f);await f.b.human('report_progress',report(t.id,0));
  const all=f.b.all.bind(f.b);
  f.b.all=async(sql,...args)=>{const rows=await all(sql,...args);if(sql.includes('FROM task_updates u')){f.b.all=all;await f.b.human('report_progress',report(t.id,1,'completed'));}return rows;};
  const read=await f.b.readTask({task_id:t.id});assert.equal(read.task.version,1);assert.equal(read.task.feedback,'Evidence at version 0');assert.deepEqual(read.updates.map(u=>u.version),[1]);assert.equal(read.task.can_report,0);
  const current=await f.b.readTask({task_id:t.id});assert.equal(current.task.version,2);assert.equal(current.updates.length,2);f.db.sqlite.close();
});
