import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,pair} from './helpers/workspace.mjs';
import {AccordHost} from '../lib/host.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
const secretTitle='Sensitive source title 71fa';
const secretBody='Retained note content c041';
const share=(w,s)=>w.human('add_source',{space_id:s.id,title:secretTitle,content:secretBody,kind:'Meeting notes'});
const state=(id,expected_version,status='withdrawn')=>({source_id:id,expected_version,status});
const proposal=(f,s,key='proposal')=>({agent_id:f.sender.id,grant_id:f.grant.id,title:'Consider the boundary',instruction:'Trace failures first.',reason:'Improve reasoning.',source_id:s.id,request_id:key});
const approve=(c,version=0,sourceVersion=0)=>({change_id:c.id,expected_version:version,expected_source_version:sourceVersion,decision:'accepted',instruction:'Trace external side effects first.'});
const clean=value=>{const json=JSON.stringify(value);assert.ok(!json.includes(secretTitle),json);assert.ok(!json.includes(secretBody),json);};
const count=(db,kind)=>db.sqlite.prepare('SELECT count(*) AS n FROM events WHERE kind=?').get(kind).n;

test('withdrawal redacts shared human, agent, host and legacy activity reads; management is explicit',async()=>{
  const f=await pair(),s=await share(f.a,f.space);
  f.db.sqlite.prepare("UPDATE events SET description=? WHERE kind='source'").run('Shared '+secretTitle);
  const host=new AccordHost(f.b),visit=await host.perform('arrive_at_accord',{agent_id:f.recipient.id,purpose:'Review shared reasoning',service:'perspective'},'agent');
  await host.perform('enter_room',{agent_id:f.recipient.id,visit_id:visit.visit.id,space_id:f.space.id},'agent');
  await f.a.human('set_source_state',state(s.id,0));
  for(const w of [f.a,f.b]){clean(await w.readSpace(f.space.id));clean(await w.bootstrap());}
  for(const [w,aid] of [[f.a,f.sender.id],[f.b,f.recipient.id]])clean(await w.agentTool('read_space',{space_id:f.space.id,agent_id:aid}));
  const guided=await host.perform('consult_host',{visit_id:visit.visit.id,agent_id:f.recipient.id},'agent');clean(guided);assert.equal(guided.room.sources.length,0);assert.ok(!guided.host.message.includes('1 shared source'));
  const ordinary=await f.b.readSource(s.id);clean(ordinary);assert.equal(ordinary.can_manage,0);assert.equal(ordinary.content,null);
  const ownerPreview=await f.a.readSource(s.id);assert.equal(ownerPreview.content,secretBody);assert.equal(ownerPreview.can_restore,true);
  assert.equal(f.db.sqlite.prepare('SELECT content FROM sources WHERE id=?').get(s.id).content,secretBody);
  await assert.rejects(f.outsider.readSource(s.id),{status:403});
  await assert.rejects(f.a.agentTool('set_source_state',{...state(s.id,1,'active'),agent_id:f.sender.id}),{status:404});
  f.db.sqlite.close();
});

test('author and owner can stop sharing; only the withdrawing person can restore',async()=>{
  const f=await pair(),s=await share(f.b,f.space);
  await f.b.human('set_source_state',state(s.id,0));
  assert.equal((await f.a.readSource(s.id)).content,secretBody);
  await assert.rejects(f.a.human('set_source_state',state(s.id,1,'active')),{status:403});
  await f.b.human('set_source_state',state(s.id,1,'active'));
  await f.a.human('set_source_state',state(s.id,2));
  await assert.rejects(f.b.human('set_source_state',state(s.id,3,'active')),{status:403});
  await f.a.human('set_source_state',state(s.id,3,'active'));
  assert.equal((await f.b.readSpace(f.space.id)).sources[0].title,secretTitle);
  const ownerSource=await share(f.a,f.space);
  await assert.rejects(f.b.human('set_source_state',state(ownerSource.id,0)),{status:403});
  await assert.rejects(f.outsider.human('set_source_state',state(ownerSource.id,0)),{status:403});
  f.db.sqlite.close();
});

test('source transitions recover immediate retries but cannot undo a newer sharing decision',async()=>{
  const f=await pair(),s=await share(f.a,f.space),args=state(s.id,0),batch=f.db.batch.bind(f.db);
  let winner;f.db.batch=async statements=>{f.db.batch=batch;winner=await f.a.human('set_source_state',args);return batch(statements);};
  assert.deepEqual(await f.a.human('set_source_state',args),winner);
  assert.deepEqual(await f.a.human('set_source_state',args),winner);assert.equal(count(f.db,'source_withdrawn'),1);
  await f.a.human('set_source_state',state(s.id,1,'active'));
  await assert.rejects(f.a.human('set_source_state',args),{status:409});
  await f.a.human('set_source_state',state(s.id,2));
  await assert.rejects(f.a.human('set_source_state',args),{status:409});
  await assert.rejects(f.a.human('set_source_state',state(s.id,1,'active')),{status:409});
  assert.equal(count(f.db,'source_withdrawn'),2);assert.equal(count(f.db,'source_restored'),1);
  f.db.sqlite.close();
});

for(const change of ['membership','ownership'])test(`source mutation rechecks ${change} at commit`,async()=>{
  const f=await pair(),s=await share(f.b,f.space),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{f.db.batch=batch;if(change==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);else f.db.sqlite.prepare('UPDATE spaces SET owner_id=? WHERE id=?').run(f.b.user.id,f.space.id);return batch(statements);};
  await assert.rejects(f.a.human('set_source_state',state(s.id,0)));
  assert.equal(f.db.sqlite.prepare('SELECT status FROM sources WHERE id=?').get(s.id).status,'active');assert.equal(count(f.db,'source_withdrawn'),0);
  f.db.sqlite.close();
});

test('departed authors cannot read retained sources, restore or withdraw without current membership',async()=>{
  const f=await pair(),s=await share(f.b,f.space),other=await share(f.b,f.space);
  await f.b.human('set_source_state',state(s.id,0));
  f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
  await assert.rejects(f.b.readSource(s.id),{status:403});
  await assert.rejects(f.b.human('set_source_state',state(s.id,1,'active')),{status:403});
  await assert.rejects(f.b.human('set_source_state',state(other.id,0)),{status:403});
  await assert.rejects(f.a.human('set_source_state',state(s.id,1,'active')),{status:403});
  f.db.sqlite.close();
});

test('withdrawal blocks new references at insertion but preserves a previous proposal receipt',async()=>{
  const f=await pair(),s=await share(f.a,f.space),args=proposal(f,s),c=await f.a.agentTool('propose_context_change',args),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{f.db.batch=batch;await f.a.human('set_source_state',state(s.id,0));return batch(statements);};
  await assert.rejects(f.a.agentTool('propose_context_change',{...args,request_id:'race'}));
  await assert.rejects(f.a.agentTool('propose_context_change',{...args,request_id:'after'}));
  assert.equal((await f.a.agentTool('propose_context_change',args)).id,c.id);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM changes').get().n,1);
  f.db.sqlite.close();
});

test('approvals pin both guidance and source versions, including withdrawal and restoration races',async()=>{
  const f=await pair(),s=await share(f.a,f.space),c=await f.a.agentTool('propose_context_change',proposal(f,s)),batch=f.db.batch.bind(f.db);
  await assert.rejects(f.b.human('decide_context',{...approve(c),expected_source_version:undefined}),{status:409});
  f.db.batch=async statements=>{f.db.batch=batch;await f.a.human('set_source_state',state(s.id,0));return batch(statements);};
  await assert.rejects(f.b.human('decide_context',approve(c)),{status:409});
  assert.equal((await f.b.home()).reviews[0].can_accept,0);
  await assert.rejects(f.b.human('decide_context',approve(c,0,1)),{status:409});
  await f.a.human('set_source_state',state(s.id,1,'active'));
  await assert.rejects(f.b.human('decide_context',approve(c)),{status:409});
  assert.equal((await f.b.home()).reviews[0].can_accept,1);
  f.db.batch=async statements=>{f.db.batch=batch;await f.a.human('set_source_state',state(s.id,2));await f.a.human('set_source_state',state(s.id,3,'active'));return batch(statements);};
  await assert.rejects(f.b.human('decide_context',approve(c,0,2)),{status:409});
  await f.b.human('decide_context',approve(c,0,4));
  assert.equal((await f.b.readSpace(f.space.id)).changes[0].status,'accepted');
  f.db.sqlite.close();
});

test('adopted guidance remains with withdrawn provenance, then restores without changing decisions',async()=>{
  const f=await pair(),s=await share(f.a,f.space),c=await f.a.agentTool('propose_context_change',proposal(f,s));
  await f.b.human('decide_context',approve(c));await f.a.human('set_source_state',state(s.id,0));
  const read=await f.b.agentTool('read_context',{agent_id:f.recipient.id});assert.equal(read.context[0].source_status,'withdrawn');assert.equal(read.context[0].source_version,1);assert.equal(read.context[0].instruction,approve(c).instruction);
  const host=new AccordHost(f.b),v=await host.perform('arrive_at_accord',{agent_id:f.recipient.id,purpose:'Review',service:'continuity'},'agent');
  const g=await host.perform('enter_room',{agent_id:f.recipient.id,visit_id:v.visit.id,space_id:f.space.id},'agent');assert.equal(g.room.context[0].source_status,'withdrawn');
  await f.a.human('set_source_state',state(s.id,1,'active'));
  const restored=(await f.b.readSpace(f.space.id)).changes[0];assert.equal(restored.source_status,'active');assert.equal(restored.status,'accepted');assert.equal(restored.version,1);
  f.db.sqlite.prepare('DELETE FROM sources WHERE id=?').run(s.id);
  assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context[0].source_status,'missing');
  f.db.sqlite.close();
});

test('failed activity write rolls back source transition and new sharing checks membership at commit',async()=>{
  const f=await pair(),s=await share(f.a,f.space),batch=f.db.batch.bind(f.db);
  f.db.sqlite.exec("CREATE TRIGGER fail_source_activity BEFORE INSERT ON events WHEN NEW.kind='source_withdrawn' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  await assert.rejects(f.a.human('set_source_state',state(s.id,0)),/rollback/);
  assert.equal((await f.a.readSource(s.id)).version,0);
  f.db.batch=async statements=>{f.db.batch=batch;f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);return batch(statements);};
  await assert.rejects(share(f.a,f.space),{status:403});assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM sources').get().n,1);
  f.db.sqlite.close();
});

test('source migration preserves existing content and starts an active version without backfill',async()=>{
  const db=database({through:'0003_worried_shaman.sql'});
  db.sqlite.prepare('INSERT INTO spaces (id,owner_id,name,purpose,topic,created_at) VALUES (?,?,?,?,?,?)').run('s','u','s','p','t','2026-01-01');
  db.sqlite.prepare('INSERT INTO sources (id,space_id,title,content,kind,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run('n','s',secretTitle,secretBody,'Note','u','2026-01-01');
  db.sqlite.exec(readFileSync(new URL('../drizzle/0004_skinny_colossus.sql',import.meta.url),'utf8'));
  const s=db.sqlite.prepare('SELECT * FROM sources WHERE id=?').get('n');assert.equal(s.content,secretBody);assert.equal(s.status,'active');assert.equal(s.version,0);assert.equal(s.updated_by,null);db.sqlite.close();
});

test('MCP handler returns tombstones and cannot expose or change retained management content',async()=>{
  const f=await pair(),s=await share(f.a,f.space);await f.a.human('set_source_state',state(s.id,0));let id=0;
  const call=async(name,args)=>{const request=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});return await(await handleMcpPost(request,async()=>f.a)).json();};
  const read=await call('read_space',{agent_id:f.sender.id,space_id:f.space.id});clean(read);assert.equal(read.result.structuredContent.sources[0].status,'withdrawn');
  assert.equal((await call('read_source',{source_id:s.id,agent_id:f.sender.id})).error.code,-32602);
  assert.equal((await call('set_source_state',{...state(s.id,1,'active'),agent_id:f.sender.id})).error.code,-32602);
  assert.equal((await f.a.readSource(s.id)).status,'withdrawn');f.db.sqlite.close();
});
