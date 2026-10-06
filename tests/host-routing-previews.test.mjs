import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {AccordHost} from '../lib/host.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {agentPageByteBudget} from '../lib/workspace.ts';

const longId='r'.repeat(128*1024-700);
const text=(unit,size)=>unit.repeat(Math.ceil(size/unit.length)).slice(0,size);
const at='2026-10-01T00:00:00.000Z';
async function call(f,name,args,id=longId) {
  const body=JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{agent_id:f.recipient.id,...args}}});
  assert.ok(Buffer.byteLength(body)<=128*1024);
  const response=await handleMcpPost(new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body}),async()=>f.b);
  assert.equal(response.status,200);
  const wire=await response.text(),message=JSON.parse(wire);
  assert.equal(message.id,id);assert.ok(!message.error);assert.ok(!message.result.isError,message.result.content[0].text);
  assert.deepEqual(JSON.parse(message.result.content[0].text),message.result.structuredContent);
  return {result:message.result.structuredContent,bytes:Buffer.byteLength(wire)};
}

async function fixture(t,unit) {
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const name=text(unit,80),purpose=text(unit,2000),title=text(unit,120),scope=text(unit,160);
  f.db.sqlite.prepare('UPDATE spaces SET name=?,topic=?,purpose=? WHERE id=?').run(name,name,purpose,f.space.id);
  f.db.sqlite.prepare('UPDATE agents SET name=? WHERE id IN (?,?)').run(name,f.sender.id,f.recipient.id);
  f.db.sqlite.prepare('UPDATE grants SET scope=? WHERE id=?').run(scope,f.grant.id);
  for(let i=0;i<19;i++) {
    const id='extra-room-'+i;
    f.db.sqlite.prepare('INSERT INTO spaces (id,owner_id,name,purpose,topic,created_at) VALUES (?,?,?,?,?,?)').run(id,f.b.user.id,name,purpose,name,at);
    f.db.sqlite.prepare("INSERT INTO members (space_id,user_id,role) VALUES (?,?,'owner')").run(id,f.b.user.id);
    f.db.sqlite.prepare('INSERT INTO space_agents (space_id,agent_id) VALUES (?,?)').run(id,f.recipient.id);
  }
  const source=await f.a.human('add_source',{space_id:f.space.id,title,content:text(unit,20000),kind:'Note'});
  const instruction=text(unit,5000),reason=text(unit,3000),previous=text(unit,3000),changes=[];
  // All records below are synthetic maximum-field fixtures, not real approvals.
  for(let i=0;i<7;i++) {
    const id='routing-guidance-'+i;
    f.db.sqlite.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,source_id,status,adopted,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,f.space.id,f.grant.id,f.sender.id,f.recipient.id,title,previous,instruction,reason,scope,source.id,'accepted',instruction,1,at,at);
    f.db.sqlite.prepare('INSERT INTO context_decisions (id,change_id,version,status,adopted,note,actor_id,channel,source_id,source_version,source_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('routing-decision-'+i,id,1,'accepted',instruction,text(unit,2000),f.b.user.id,'human',source.id,0,'active',at);
    changes.push(id);
    f.db.sqlite.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,version,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('routing-task-'+i,f.space.id,f.grant.id,f.sender.id,f.recipient.id,title,text(unit,8000),'working',text(unit,8000),1,'agent',at,at);
    f.db.sqlite.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('routing-review-'+i,f.space.id,f.grant.id,f.sender.id,f.recipient.id,title,previous,instruction,reason,scope,'pending',0,at,at);
  }
  return {...f,purpose,instruction,reason,previous,changes,source};
}

for(const [label,unit] of [['escaped control','\u0001'],['CJK','界']])test(`agent host routing fits twenty full room purposes and six ${label} guidance previews in one complete MCP reply`,async t=>{
  const f=await fixture(t,unit),start=await call(f,'arrive_at_accord',{purpose:f.purpose,service:'continuity'},1);
  assert.equal(start.result.rooms.length,20);assert.ok(start.bytes<=agentPageByteBudget);
  const entered=await call(f,'enter_room',{visit_id:start.result.visit.id,space_id:f.space.id});
  const refreshed=await call(f,'consult_host',{visit_id:start.result.visit.id});
  if(unit==='\u0001') {
    const previous={...entered.result,room:{...entered.result.room,context:entered.result.room.context.map(row=>{const {from_agent,to_agent,...metadata}=row;assert.ok(from_agent&&to_agent);return {...metadata,instruction:f.instruction,reason:f.reason};}),note:'These are bounded previews. Use read_space_section for room records, read_inbox for all actionable work and read_context for all current accepted guidance. Preview limits do not decide authority.'}};
    delete previous.room.context_summaries;
    const previousBytes=Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:longId,result:{content:[{type:'text',text:JSON.stringify(previous)}],structuredContent:previous}}));
    assert.ok(previousBytes>agentPageByteBudget,'the fixture must reproduce the earlier combined routing overflow');
    t.diagnostic(`Escaped routing reply: ${previousBytes} bytes with full guidance; ${entered.bytes} bytes with exact-reader-directed summaries.`);
  }
  for(const page of [entered,refreshed]) {
    assert.ok(page.bytes<=agentPageByteBudget,`${label} routing reply emitted ${page.bytes} bytes`);
    assert.equal(page.result.rooms.length,20);assert.equal(page.result.room.context.length,6);assert.equal(page.result.room.more.context,true);
    assert.equal(page.result.room.context_summaries,true);assert.match(page.result.room.note,/Before using it, read the complete wording and reason with read_context/);assert.match(page.result.room.note,/read_context_change/);
    for(const room of page.result.rooms)assert.equal(room.purpose,f.purpose);
    for(const row of page.result.room.context) {
      assert.ok(f.changes.includes(row.id));assert.equal(row.space_id,f.space.id);assert.equal(row.from_agent,f.sender.id);assert.equal(row.to_agent,f.recipient.id);
      assert.equal(row.version,1);assert.equal(row.title,text(unit,120));assert.equal(row.scope,text(unit,160));assert.equal(row.source_id,f.source.id);
      assert.equal(row.source_status,'active');assert.equal(row.source_version,0);
      for(const key of ['instruction','adopted','previous','reason'])assert.equal(Object.hasOwn(row,key),false);
    }
    for(const row of page.result.room.inbox)for(const key of ['body','feedback'])assert.equal(Object.hasOwn(row,key),false);
    for(const row of page.result.room.sources)assert.equal(Object.hasOwn(row,'content'),false);
    for(const row of page.result.room.reviews)for(const key of ['instruction','reason'])assert.equal(Object.hasOwn(row,key),false);
    assert.equal(page.result.room.permissions.accept_context,false);
  }
  const context=await call(f,'read_context',{limit:100});
  assert.equal(context.result.context.length,7);
  for(const row of context.result.context){assert.equal(row.instruction,f.instruction);assert.equal(row.reason,f.reason);}
  const one=await call(f,'read_context_change',{change_id:f.changes[0],limit:100});
  assert.equal(one.result.current.instruction,f.instruction);assert.equal(one.result.current.adopted,f.instruction);assert.equal(one.result.current.previous,f.previous);assert.equal(one.result.current.reason,f.reason);
  assert.equal(one.result.history[0].adopted,f.instruction);assert.equal(one.result.history[0].note,text(unit,2000));
  const human=await f.b.hostRoom(f.space.id);
  assert.ok(!Object.hasOwn(human,'context_summaries'));assert.equal(human.context.length,6);
  for(const row of human.context){assert.equal(row.instruction,f.instruction);assert.equal(row.reason,f.reason);}
});

test('agent routing preserves current source provenance and decisions while exact guidance remains complete',async t=>{
  const f=await fixture(t,'界'),host=new AccordHost(f.b),start=await host.perform('arrive_at_accord',{agent_id:f.recipient.id,purpose:'Review guidance',service:'continuity'},'agent');
  await host.perform('enter_room',{agent_id:f.recipient.id,visit_id:start.visit.id,space_id:f.space.id},'agent');
  await f.a.human('set_source_state',{source_id:f.source.id,expected_version:0,status:'withdrawn'});
  const result=await host.perform('consult_host',{agent_id:f.recipient.id,visit_id:start.visit.id},'agent');
  assert.equal(result.room.context.length,6);assert.equal(result.room.sources.length,0);
  for(const row of result.room.context){assert.equal(row.source_status,'withdrawn');assert.equal(row.source_version,1);assert.equal(row.source_id,f.source.id);}
  const exact=await f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:f.changes[6]});
  assert.equal(exact.current.adopted,f.instruction);assert.equal(exact.current.reason,f.reason);assert.equal(exact.current.source_status,'withdrawn');assert.equal(exact.history[0].source_status,'active');
  await f.b.human('decide_context',{change_id:f.changes[6],expected_version:1,expected_source_version:1,decision:'declined',decision_note:'Reconsidered synthetic guidance'});
  const next=await host.perform('consult_host',{agent_id:f.recipient.id,visit_id:start.visit.id},'agent');
  assert.ok(!next.room.context.some(row=>row.id===f.changes[6]));assert.equal(next.room.more.context,false);
  assert.ok(!(await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.some(row=>row.id===f.changes[6]));
  const history=await f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:f.changes[6]});
  assert.equal(history.current.status,'declined');assert.equal(history.history[0].adopted,f.instruction);assert.equal(history.history[1].note,'Reconsidered synthetic guidance');
});

for(const mutation of ['membership','attachment','profile','ownership'])test(`agent routing previews retain final ${mutation} guards`,async t=>{
  const f=await fixture(t,'x'),all=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{
    const rows=await all(sql,...args);
    if(!changed&&sql.includes("c.status='accepted'")) {
      changed=true;
      if(mutation==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
      if(mutation==='attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
      if(mutation==='profile')f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id);
      if(mutation==='ownership')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.a.user.id,f.recipient.id);
    }
    return rows;
  };
  await assert.rejects(f.b.hostRoom(f.space.id,f.recipient.id),{status:403});assert.ok(changed);
});

test('source withdrawal during routing finalization removes source previews and later reads refresh guidance provenance',async t=>{
  const f=await fixture(t,'界'),all=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{
    if(!changed&&sql.includes('LEFT JOIN json_each(?) requested')){changed=true;await f.a.human('set_source_state',{source_id:f.source.id,expected_version:0,status:'withdrawn'});}
    return all(sql,...args);
  };
  const result=await f.b.hostRoom(f.space.id,f.recipient.id);
  assert.ok(changed);assert.equal(result.sources.length,0);
  for(const row of result.context){assert.equal(Object.hasOwn(row,'instruction'),false);assert.equal(Object.hasOwn(row,'reason'),false);}
  const fresh=await f.b.hostRoom(f.space.id,f.recipient.id);
  assert.ok(fresh.context.every(row=>row.source_status==='withdrawn'&&row.source_version===1));
});
