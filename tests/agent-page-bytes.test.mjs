import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {agentPageByteBudget,pageRequest,pageResult} from '../lib/workspace.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';

const longId='r'.repeat(128*1024-700);
const text=(unit,length)=>unit.repeat(Math.ceil(length/unit.length)).slice(0,length);
const date=i=>new Date(Date.UTC(2026,9,1,0,0,Math.floor(i/4))).toISOString();
const decode=cursor=>JSON.parse(Buffer.from(cursor,'base64url'));
const rpc=async(f,name,args,id=longId)=>{
  const body=JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{agent_id:f.recipient.id,...args}}});
  assert.ok(Buffer.byteLength(body)<=128*1024,'the large request ID must still fit the input contract');
  const response=await handleMcpPost(new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body}),async()=>f.b);
  assert.equal(response.status,200);
  const wire=await response.text(),message=JSON.parse(wire);
  assert.equal(message.id,id);assert.ok(!message.error);assert.ok(!message.result.isError,message.result.content[0].text);
  assert.deepEqual(JSON.parse(message.result.content[0].text),message.result.structuredContent);
  return {result:message.result.structuredContent,bytes:Buffer.byteLength(wire)};
};

async function fixture(t,unit='界',count=123) {
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const source=await f.a.human('add_source',{space_id:f.space.id,title:'Synthetic provenance',content:'Synthetic evidence only',kind:'Note'});
  f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=2 WHERE id=?").run(source.id);
  const taskInsert=f.db.sqlite.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,version,channel,request_key,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const changeInsert=f.db.sqlite.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,source_id,status,adopted,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const tasks=[],context=[];
  // Direct inserts model maximum valid records in a synthetic database; no real
  // owner's acceptance or reporting is invented by this fixture.
  for(let i=0;i<count;i++) {
    const suffix=String(i).padStart(3,'0'),body=text(unit,8000),feedback=text(unit,8000),instruction=text(unit,5000),reason=text(unit,3000);
    taskInsert.run('task-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Task '+suffix,body,'working',feedback,100,'agent','key-'+suffix,'h'.repeat(64),date(i),date(i));
    const sourceId=i%3===0?source.id:i%3===1?'missing-source':null;
    changeInsert.run('change-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Guidance '+suffix,text(unit,3000),instruction,reason,'Engineering',sourceId,'accepted',instruction,100,date(i),date(i));
    tasks.push({id:'task-'+suffix,body,feedback});
    context.push({id:'change-'+suffix,instruction,reason,source_id:sourceId,source_status:i%3===0?'withdrawn':i%3===1?'missing':null,source_version:i%3===0?2:null});
  }
  return {...f,tasks,context};
}

async function walk(f,name,key,args={}) {
  const items=[],pages=[];let cursor;
  do {
    const page=await rpc(f,name,{limit:100,...args,...(cursor?{cursor}:{})});
    assert.ok(page.bytes<=agentPageByteBudget,`${name} emitted ${page.bytes} bytes`);
    assert.ok(page.result[key].length<=100);assert.ok(!page.result.oversized_record);
    if(page.result.next_cursor) {
      assert.ok(page.result[key].length>0,'a continuing page must make progress');
      assert.equal(decode(page.result.next_cursor).id,page.result[key].at(-1).id);
    }
    items.push(...page.result[key]);pages.push(page);cursor=page.result.next_cursor;
    assert.ok(pages.length<200,'pagination must finish');
  }while(cursor);
  return {items,pages};
}

for(const [label,unit] of [['CJK','界'],['escaped control','\u0001'],['mixed supplementary and escaping','😀"\\\n']])test(`full inbox and approved guidance paginate complete ${label} records within the duplicated MCP budget`,async t=>{
  const f=await fixture(t,unit),inbox=await walk(f,'read_inbox','instructions'),context=await walk(f,'read_context','context');
  assert.ok(inbox.pages[0].result.instructions.length<100);assert.ok(context.pages[0].result.context.length<100);
  assert.deepEqual(inbox.items.map(row=>row.id),f.tasks.map(row=>row.id));
  assert.deepEqual(context.items.map(row=>row.id),f.context.map(row=>row.id));
  assert.equal(new Set(inbox.items.map(row=>row.id)).size,f.tasks.length);
  assert.equal(new Set(context.items.map(row=>row.id)).size,f.context.length);
  for(const [index,row] of inbox.items.entries()) {
    assert.equal(row.body,f.tasks[index].body);assert.equal(row.feedback,f.tasks[index].feedback);
    assert.equal(row.request_key,'key-'+String(index).padStart(3,'0'));assert.equal(row.request_hash,'h'.repeat(64));
  }
  for(const [index,row] of context.items.entries()) {
    for(const key of ['instruction','reason','source_id','source_status','source_version'])assert.equal(row[key],f.context[index][key],key);
    assert.equal(row.from_agent,f.sender.id);assert.equal(row.scope,'Engineering');
  }
});

async function histories(f,unit) {
  const report=f.db.sqlite.prepare('INSERT INTO task_updates (id,task_id,version,status,feedback,actor_id,agent_id,channel,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const decision=f.db.sqlite.prepare('INSERT INTO context_decisions (id,change_id,version,status,adopted,note,actor_id,channel,source_id,source_version,source_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for(let version=1;version<=100;version++) {
    report.run('report-'+String(version).padStart(3,'0'),f.tasks[0].id,version,'working',text(unit,8000),f.b.user.id,f.recipient.id,'agent',date(0));
    decision.run('decision-'+String(version).padStart(3,'0'),f.context[0].id,version,'accepted',text(unit,5000),text(unit,2000),f.b.user.id,'human',f.context[0].source_id,version,'active',date(0));
  }
}

for(const unit of ['界','\u0001'])test(`exact task and guidance histories budget their complete base records as well as ${unit==='界'?'CJK':'escaped'} history`,async t=>{
  const f=await fixture(t,unit,1);await histories(f,unit);
  const task=await walk(f,'read_task','updates',{task_id:f.tasks[0].id});
  const guidance=await walk(f,'read_context_change','history',{change_id:f.context[0].id});
  assert.ok(task.pages[0].result.updates.length<100);assert.ok(guidance.pages[0].result.history.length<100);
  assert.deepEqual(task.items.map(row=>row.version),Array.from({length:100},(_,i)=>i+1));
  assert.deepEqual(guidance.items.map(row=>row.version),Array.from({length:100},(_,i)=>i+1));
  for(const page of task.pages) {
    assert.equal(page.result.task.body,f.tasks[0].body);assert.equal(page.result.task.feedback,f.tasks[0].feedback);
    assert.equal(page.result.task.version,100);assert.equal(page.result.task.can_report,1);
    for(const row of page.result.updates){assert.equal(row.feedback,text(unit,8000));assert.equal(row.actor_id,f.b.user.id);assert.equal(row.agent_id,f.recipient.id);}
  }
  for(const page of guidance.pages) {
    assert.equal(page.result.current.instruction,text(unit,5000));assert.equal(page.result.current.adopted,text(unit,5000));
    assert.equal(page.result.current.previous,text(unit,3000));assert.equal(page.result.current.reason,text(unit,3000));
    assert.equal(page.result.current.can_decide,0);assert.equal(page.result.current.source_status,'withdrawn');
    for(const row of page.result.history){assert.equal(row.adopted,text(unit,5000));assert.equal(row.note,text(unit,2000));assert.equal(row.source_status,'active');assert.equal(row.source_version,row.version);}
  }
  assert.equal((await f.b.readTask({task_id:f.tasks[0].id,limit:100})).updates.length,100,'human row pagination stays unchanged');
  assert.equal((await f.b.readGuidance({change_id:f.context[0].id,limit:100})).history.length,100);
});

test('full pages size compact indexed metadata first, then fetch only bound selected IDs',async t=>{
  const f=await fixture(t,'\u0001'),original=f.b.all.bind(f.b),calls=[];
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);calls.push({sql,args,rows});return rows;};
  const page=await f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:100});
  const metadata=calls.find(call=>call.sql.includes('AS payload_bytes')),detail=calls.find(call=>call.sql.includes('IN (SELECT value FROM json_each(?))'));
  assert.deepEqual(Object.keys(metadata.rows[0]).sort(),['created_at','id','payload_bytes','version']);
  assert.equal(metadata.rows.length,101);assert.ok(!metadata.sql.includes('t.*'));
  assert.deepEqual(JSON.parse(detail.args.at(-2)),page.instructions.map(row=>row.id));
  assert.equal(detail.rows.length,page.instructions.length);assert.ok(detail.rows.length<100);
  assert.ok(!detail.sql.includes('task-000'),'selected IDs must remain bound data');
  for(const call of [metadata,detail]) {
    const plan=f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+call.sql).all(...call.args).map(row=>row.detail);
    assert.ok(plan.some(line=>line.includes('tasks_actionable_page')));
    assert.ok(!plan.some(line=>line.includes('USE TEMP B-TREE FOR ORDER BY')));
  }
});

test('historic full cursors remain valid when a later request shrinks by bytes',async t=>{
  const f=await fixture(t,'\u0001'),scope=JSON.stringify(['inbox',f.b.user.id,f.recipient.id,'']);
  const rows=f.db.sqlite.prepare('SELECT id,created_at FROM tasks ORDER BY created_at,id LIMIT 3').all();
  const historical=pageResult(rows,pageRequest({limit:2},scope)).next_cursor;
  const page=await f.b.agentTool('read_inbox',{agent_id:f.recipient.id,cursor:historical,limit:100});
  assert.equal(page.instructions[0].id,'task-002');assert.ok(page.instructions.length<100);
  await assert.rejects(f.b.agentTool('read_inbox',{agent_id:f.recipient.id,cursor:historical,projection:'summary'}));
  await assert.rejects(f.b.agentTool('read_context',{agent_id:f.recipient.id,cursor:historical}));
});

for(const mutation of ['grant','profile','recipient membership','sender membership','attachment','ownership','version','status'])test(`full inbox rechecks ${mutation} between sizing and selected detail retrieval`,async t=>{
  const f=await fixture(t,'界',3);
  const invitation=await f.a.human('invite_member',{space_id:f.space.id,email:f.outsider.user.email,role:'participant'});await f.outsider.human('join_space',{code:invitation.code});
  const original=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{
    const rows=await original(sql,...args);
    if(!changed&&sql.includes('AS payload_bytes')) {
      changed=true;
      if(mutation==='grant')f.db.sqlite.prepare("UPDATE grants SET status='revoked' WHERE id=?").run(f.grant.id);
      if(mutation==='profile')f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id);
      if(mutation==='recipient membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
      if(mutation==='sender membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);
      if(mutation==='attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
      if(mutation==='ownership')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id);
      if(mutation==='version')f.db.sqlite.prepare('UPDATE tasks SET version=version+1 WHERE id=?').run('task-000');
      if(mutation==='status')f.db.sqlite.prepare("UPDATE tasks SET status='completed' WHERE id=?").run('task-000');
    }
    return rows;
  };
  await assert.rejects(f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:100}),{status:409});assert.ok(changed);
  if(mutation==='version'||mutation==='status') {
    const retry=await f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:100});
    assert.deepEqual(retry.instructions.map(row=>row.id),mutation==='status'?['task-001','task-002']:['task-000','task-001','task-002']);
  }
});

test('a grant that expires during metadata retrieval is checked against a fresh clock',async t=>{
  const f=await fixture(t,'界',3),start=Date.now();
  t.mock.timers.enable({apis:['Date'],now:start});
  f.db.sqlite.prepare('UPDATE grants SET expires_at=? WHERE id=?').run(new Date(start+1000).toISOString(),f.grant.id);
  const original=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(!changed&&sql.includes('AS payload_bytes')){changed=true;t.mock.timers.tick(2000);}return rows;};
  await assert.rejects(f.b.agentTool('read_inbox',{agent_id:f.recipient.id}),{status:409});assert.ok(changed);
  assert.deepEqual((await f.b.agentTool('read_inbox',{agent_id:f.recipient.id})).instructions,[]);
});

for(const mutation of ['membership','ownership','attachment','version','status'])test(`approved context rechecks ${mutation} between sizing and final retrieval`,async t=>{
  const f=await fixture(t,'界',3),original=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(!changed&&sql.includes('AS payload_bytes')) {
    changed=true;
    if(mutation==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
    if(mutation==='ownership')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.a.user.id,f.recipient.id);
    if(mutation==='attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
    if(mutation==='version')f.db.sqlite.prepare('UPDATE changes SET version=version+1 WHERE id=?').run('change-000');
    if(mutation==='status')f.db.sqlite.prepare("UPDATE changes SET status='pending' WHERE id=?").run('change-000');
  }return rows;};
  await assert.rejects(f.b.agentTool('read_context',{agent_id:f.recipient.id,limit:100}),{status:409});assert.ok(changed);
});

for(const [name,key,idKey,idPrefix] of [['read_task','updates','task_id','task'],['read_context_change','history','change_id','change']])test(`${name} retains its final access check after byte selection`,async t=>{
  const f=await fixture(t,'界',1);await histories(f,'界');const original=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(sql.includes('IN (SELECT value FROM json_each(?))')){changed=true;f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);}return rows;};
  await assert.rejects(f.b.agentTool(name,{agent_id:f.recipient.id,[idKey]:idPrefix+'-000',limit:100}),{status:403});assert.ok(changed);
  assert.ok(key);
});

test('oversized legacy records stay whole, signal the exception, and advance only past returned items',async t=>{
  const f=await fixture(t,'x',3),huge='界'.repeat(400000);
  f.db.sqlite.exec('ALTER TABLE tasks ADD extra_legacy_text TEXT');
  f.db.sqlite.prepare('UPDATE tasks SET extra_legacy_text=? WHERE id=?').run(huge,'task-000');
  const first=await f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:100});
  assert.equal(first.instructions.length,1);assert.equal(first.instructions[0].extra_legacy_text,huge);assert.equal(first.oversized_record,true);
  assert.equal(decode(first.next_cursor).id,'task-000');
  const rest=await f.b.agentTool('read_inbox',{agent_id:f.recipient.id,limit:100,cursor:first.next_cursor});
  assert.deepEqual(rest.instructions.map(row=>row.id),['task-001','task-002']);assert.equal(rest.next_cursor,null);assert.ok(!rest.oversized_record);
  f.db.sqlite.prepare('UPDATE tasks SET body=? WHERE id=?').run(huge,'task-001');
  const exact=await f.b.agentTool('read_task',{agent_id:f.recipient.id,task_id:'task-001'});
  assert.equal(exact.task.body,huge);assert.equal(exact.oversized_record,true);
});

test('agent room lists byte-bound maximum escaped purposes while preserving descending cursors and full purposes',async t=>{
  const f=await fixture(t,'x',0),purpose='\u0001'.repeat(2000),insert=f.db.sqlite.prepare('INSERT INTO spaces (id,owner_id,name,purpose,topic,created_at) VALUES (?,?,?,?,?,?)');
  for(let i=0;i<123;i++) {
    const id='room-'+String(i).padStart(3,'0');insert.run(id,f.b.user.id,'Room '+i,purpose,'Topic',date(i));
    f.db.sqlite.prepare("INSERT INTO members (space_id,user_id,role) VALUES (?,?,'owner')").run(id,f.b.user.id);
    f.db.sqlite.prepare('INSERT INTO space_agents (space_id,agent_id) VALUES (?,?)').run(id,f.recipient.id);
  }
  const result=await walk(f,'list_spaces','spaces');
  const expected=f.db.sqlite.prepare('SELECT s.id FROM spaces s JOIN space_agents sa ON sa.space_id=s.id WHERE sa.agent_id=? ORDER BY s.created_at DESC,s.id DESC').all(f.recipient.id).map(row=>row.id);
  assert.deepEqual(result.items.map(row=>row.id),expected);assert.ok(result.pages[0].result.spaces.length<100);
  for(const row of result.items.filter(row=>row.id.startsWith('room-')))assert.equal(row.purpose,purpose);
  for(const page of result.pages)assert.equal(page.result.more,page.result.next_cursor!==null);
});

test('agent room detail fetch rechecks current ownership and room attachment',async t=>{
  const f=await fixture(t,'x',0),original=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(!changed&&sql.includes('AS payload_bytes')){changed=true;f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);}return rows;};
  await assert.rejects(f.b.agentTool('list_spaces',{agent_id:f.recipient.id}),{status:409});assert.ok(changed);
});
