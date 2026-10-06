import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {AccordHost} from '../lib/host.ts';

const at=i=>new Date(Date.UTC(2026,9,1,0,0,i)).toISOString();
const sizedSql=sql=>sql.replace(',length(CAST(json_object',',agent_payload_probe(length(CAST(json_object').replace(' AS payload_bytes',') AS payload_bytes');

function observeSizing(f,workspace=f.b) {
  let evaluated=0;
  f.db.sqlite.function('agent_payload_probe',value=>{evaluated++;return value;});
  const original=workspace.all.bind(workspace),queries=[];
  workspace.all=async(sql,...args)=>{
    if(!sql.includes('AS payload_bytes'))return original(sql,...args);
    const before=evaluated,rows=await original(sizedSql(sql),...args);
    queries.push({sql,args,rows,evaluated:evaluated-before});return rows;
  };
  return {queries,original,get evaluated(){return evaluated;}};
}

async function rooms(t) {
  const f=await pair();t.after(()=>f.db.sqlite.close());
  f.db.sqlite.prepare('UPDATE spaces SET purpose=? WHERE id=?').run('\u0001'.repeat(2000),f.space.id);
  const insert=f.db.sqlite.prepare('INSERT INTO spaces (id,owner_id,name,purpose,topic,created_at) VALUES (?,?,?,?,?,?)');
  const member=f.db.sqlite.prepare("INSERT INTO members (space_id,user_id,role) VALUES (?,?,'owner')");
  const attach=f.db.sqlite.prepare('INSERT INTO space_agents (space_id,agent_id) VALUES (?,?)');
  for(let i=0;i<1000;i++) {
    const id='adverse-room-'+String(i).padStart(4,'0');
    // The attachment index visits ascending IDs, while later dates rank first.
    // This forces every new row to improve the old bounded sort's candidate heap.
    insert.run(id,f.b.user.id,'Synthetic room','\u0001'.repeat(2000),'Probe',at(i));
    member.run(id,f.b.user.id);attach.run(id,f.recipient.id);
  }
  return f;
}

test('room candidate materialization bounds actual text sizing under adverse 1,001-room ordering',async t=>{
  const f=await rooms(t),probe=observeSizing(f);
  const first=await f.b.listAgentRooms({limit:20},f.recipient.id),query=probe.queries[0];
  assert.equal(query.rows.length,21);assert.equal(query.evaluated,21);assert.equal(first.spaces.length,20);assert.ok(first.next_cursor);
  assert.deepEqual(Object.keys(query.rows[0]).sort(),['created_at','id','payload_bytes','version']);
  assert.ok(query.rows.every(row=>row.payload_bytes>20000),'the probe must exercise full escaped purposes');
  const plan=f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.args).map(row=>row.detail);
  assert.ok(plan.some(line=>line.includes('MATERIALIZE agent_page_candidates')));
  assert.ok(plan.some(line=>line.includes('USE TEMP B-TREE FOR ORDER BY')),'lightweight eligible-row sorting is still present and must not be hidden by this fix');
  // Reconstruct the previous SELECT from the current fixed projection to verify
  // that this fixture reproduces real projection work beyond LIMIT, not just a
  // particular query-string shape. Only this synthetic database is queried.
  const previous=query.sql.slice(query.sql.indexOf(') SELECT')+2).replace(' AND s.id IN (SELECT id FROM agent_page_candidates)','');
  const before=probe.evaluated,previousRows=await probe.original(sizedSql(previous),...query.args.slice(query.args.length/2));
  assert.equal(previousRows.length,21);assert.equal(probe.evaluated-before,1001);
  const second=await f.b.listAgentRooms({limit:20,cursor:first.next_cursor},f.recipient.id);
  assert.equal(probe.queries[1].evaluated,21);assert.equal(second.spaces.length,20);
  assert.ok(!second.spaces.some(row=>first.spaces.some(earlier=>earlier.id===row.id)));
  t.diagnostic('Requested 20 rooms: SQL text sizing fell from 1,001 rows to 21; eligible metadata scan/sort remains.');
});

async function records(t) {
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const task=f.db.sqlite.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,version,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const change=f.db.sqlite.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,adopted,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const visit=f.db.sqlite.prepare('INSERT INTO host_visits (id,owner_id,agent_id,purpose,service,status,outcome,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const report=f.db.sqlite.prepare('INSERT INTO task_updates (id,task_id,version,status,feedback,actor_id,agent_id,channel,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const decision=f.db.sqlite.prepare('INSERT INTO context_decisions (id,change_id,version,status,adopted,note,actor_id,channel,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const body='\u0001'.repeat(8000),instruction='界'.repeat(5000),reason='界'.repeat(3000);
  for(let i=0;i<123;i++) {
    const suffix=String(i).padStart(3,'0');
    task.run('candidate-task-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Synthetic task',body,'working',body,123,'agent',at(i),at(i));
    change.run('candidate-change-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Synthetic guidance','',instruction,reason,'Scope','accepted',instruction,123,at(i),at(i));
    visit.run('candidate-visit-'+suffix,f.b.user.id,f.recipient.id,'\u0001'.repeat(2000),'continuity','arrived','\u0001'.repeat(4000),at(i),at(i));
    report.run('candidate-report-'+suffix,'candidate-task-000',i+1,'working',body,f.b.user.id,f.recipient.id,'agent',at(i));
    decision.run('candidate-decision-'+suffix,'candidate-change-000',i+1,'accepted',instruction,'界'.repeat(2000),f.b.user.id,'human',at(i));
  }
  return {...f,body,instruction,reason};
}

for(const [name,key,args] of [
  ['read_inbox','instructions',{}],['read_context','context',{}],
  ['read_task','updates',{task_id:'candidate-task-000'}],
  ['read_context_change','history',{change_id:'candidate-change-000'}],
  ['list_sessions','sessions',{}],
])test(`${name} sizes no more than requested candidates before exact full retrieval`,async t=>{
  const f=await records(t),probe=observeSizing(f),host=new AccordHost(f.b);
  const read=extra=>name==='list_sessions'?host.agentSessions({agent_id:f.recipient.id,...args,...extra}):f.b.agentTool(name,{agent_id:f.recipient.id,...args,...extra});
  const first=await read({limit:7}),second=await read({limit:7,cursor:first.next_cursor});
  assert.ok(first[key].length>0&&first[key].length<=7);assert.ok(first.next_cursor);assert.ok(second[key].length>0);
  assert.equal(probe.queries.length,2);
  for(const query of probe.queries){assert.equal(query.rows.length,8);assert.equal(query.evaluated,8);}
  assert.ok(!second[key].some(row=>first[key].some(earlier=>earlier.id===row.id)));
  if(name==='read_inbox')for(const row of first.instructions){assert.equal(row.body,f.body);assert.equal(row.feedback,f.body);}
  if(name==='read_context')for(const row of first.context){assert.equal(row.instruction,f.instruction);assert.equal(row.reason,f.reason);}
  if(name==='read_task'){assert.equal(first.task.body,f.body);for(const row of first.updates)assert.equal(row.feedback,f.body);}
  if(name==='read_context_change'){assert.equal(first.current.adopted,f.instruction);for(const row of first.history)assert.equal(row.adopted,f.instruction);}
});

test('candidate selection and sizing share one fresh expiry clock; exact fetch gets a newer clock',async t=>{
  const f=await records(t),original=f.b.all.bind(f.b),times=[];let advanced=false;
  const started=Date.now();t.mock.timers.enable({apis:['Date'],now:started});
  f.db.sqlite.prepare('UPDATE grants SET expires_at=? WHERE id=?').run(new Date(started+1000).toISOString(),f.grant.id);
  f.b.all=async(sql,...args)=>{
    if(sql.includes('AS payload_bytes')) {
      const half=args.length/2;
      assert.deepEqual(args.slice(0,half),args.slice(half),'both metadata passes share the same clock and cursor bindings');
      times.push(args[3]);
      const result=await original(sql,...args);
      t.mock.timers.tick(2000);advanced=true;return result;
    }
    if(sql.includes('IN (SELECT value FROM json_each(?))'))times.push(args[3]);
    return original(sql,...args);
  };
  await assert.rejects(f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:7}),{status:409});
  assert.ok(advanced);assert.equal(times.length,2);assert.ok(Date.parse(times[1])>Date.parse(times[0]));
});
