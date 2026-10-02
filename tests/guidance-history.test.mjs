import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,pair} from './helpers/workspace.mjs';
import {handleMcpPost} from '../lib/mcp-http.ts';
const decide=(id,version,status='accepted',key='decision-'+version)=>({change_id:id,expected_version:version,expected_source_version:0,decision:status,instruction:'Wording '+version,decision_note:'Reason '+version,request_id:key});
const sourceState=(id,version,status='withdrawn')=>({source_id:id,expected_version:version,status});
const count=(db,table)=>db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
async function proposed(f,source=false){
  const s=source?await f.a.human('add_source',{space_id:f.space.id,title:'Shared source',content:'Source body',kind:'Note'}):null;
  const c=await f.a.human('propose_context_change',{grant_id:f.grant.id,title:'Trace the boundary',instruction:'Original proposal',reason:'Evidence first',source_id:s?.id});return{c,s};
}

test('decision history preserves wording and owner notes while only the current acceptance remains active',async()=>{
  const f=await pair(),{c}=await proposed(f);
  assert.equal((await f.b.readGuidance({change_id:c.id})).history.length,0);
  for(const [version,status] of [[0,'accepted'],[1,'pending'],[2,'accepted'],[3,'declined']]){
    await f.b.human('decide_context',decide(c.id,version,status));
    assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.length,status==='accepted'?1:0);
  }
  const r=await f.b.readGuidance({change_id:c.id});
  assert.deepEqual(r.history.map(x=>x.version),[1,2,3,4]);assert.deepEqual(r.history.map(x=>x.status),['accepted','pending','accepted','declined']);
  assert.deepEqual(r.history.map(x=>x.adopted),['Wording 0',null,'Wording 2',null]);assert.deepEqual(r.history.map(x=>x.note),['Reason 0','Reason 1','Reason 2','Reason 3']);
  assert.ok(r.history.every(x=>x.actor_id===f.b.user.id&&x.channel==='human'));assert.equal(r.current.adopted,null);assert.match(r.note,/not active instructions/);
  f.db.sqlite.close();
});

test('identical saved-decision retries recover after later decisions, withdrawal, revocation and disconnection without reactivating guidance',async()=>{
  const f=await pair(),{c,s}=await proposed(f,true),args=decide(c.id,0),receipt=await f.b.human('decide_context',args);
  await f.b.human('decide_context',decide(c.id,1,'pending'));
  await f.a.human('set_source_state',sourceState(s.id,0));await f.b.human('revoke_authority',{grant_id:f.grant.id});await f.b.human('disconnect_agent',{agent_id:f.recipient.id});
  assert.deepEqual(await f.b.human('decide_context',args),receipt);assert.match(receipt.note,/saved decision/);
  const r=await f.b.readGuidance({change_id:c.id});assert.equal(r.current.status,'pending');assert.equal(r.current.version,2);assert.equal(r.current.can_accept,0);assert.equal(r.history.length,2);
  await f.b.human('decide_context',decide(c.id,2,'declined'));assert.equal((await f.b.readGuidance({change_id:c.id})).current.status,'declined');
  await assert.rejects(f.b.human('decide_context',{...args,instruction:'Changed content'}),{status:409});
  await assert.rejects(f.b.human('decide_context',{...args,decision_note:'Different reason'}),{status:409});
  await assert.rejects(f.b.human('decide_context',{...args,expected_source_version:1}),{status:409});
  f.db.sqlite.close();
});

test('competing identical decisions recover one record and event; a different competing decision conflicts',async()=>{
  const f=await pair(),{c}=await proposed(f),args=decide(c.id,0),batch=f.db.batch.bind(f.db);let winner;
  const events=count(f.db,'events');f.db.batch=async stmts=>{f.db.batch=batch;winner=await f.b.human('decide_context',args);return batch(stmts);};
  assert.deepEqual(await f.b.human('decide_context',args),winner);assert.equal(count(f.db,'context_decisions'),1);assert.equal(count(f.db,'events'),events+1);
  f.db.batch=async stmts=>{f.db.batch=batch;await f.b.human('decide_context',decide(c.id,1,'declined','winner'));return batch(stmts);};
  await assert.rejects(f.b.human('decide_context',decide(c.id,1,'pending','loser')),{status:409});
  assert.equal(count(f.db,'context_decisions'),2);assert.equal(count(f.db,'events'),events+2);f.db.sqlite.close();
});

for(const mutation of ['membership','ownership','grant','source','attachment'])test(`guidance acceptance rechecks ${mutation} before projection and history writes`,async()=>{
  const f=await pair(),{c,s}=await proposed(f,true),batch=f.db.batch.bind(f.db),events=count(f.db,'events');
  f.db.batch=async stmts=>{f.db.batch=batch;
    if(mutation==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
    if(mutation==='ownership')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.a.user.id,f.recipient.id);
    if(mutation==='grant')f.db.sqlite.prepare("UPDATE grants SET status='revoked' WHERE id=?").run(f.grant.id);
    if(mutation==='source')f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id=?").run(s.id);
    if(mutation==='attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
    return batch(stmts);
  };
  await assert.rejects(f.b.human('decide_context',decide(c.id,0)),{status:409});assert.equal(count(f.db,'context_decisions'),0);assert.equal(count(f.db,'events'),events);assert.equal(f.db.sqlite.prepare('SELECT version FROM changes WHERE id=?').get(c.id).version,0);f.db.sqlite.close();
});

test('historical source provenance is captured inside the decision transaction and stays separate from current state',async()=>{
  const f=await pair(),{c,s}=await proposed(f,true),batch=f.db.batch.bind(f.db);await f.b.human('decide_context',decide(c.id,0));
  f.db.batch=async stmts=>{f.db.batch=batch;await f.a.human('set_source_state',sourceState(s.id,0));return batch(stmts);};
  await f.b.human('decide_context',decide(c.id,1,'pending'));
  const r=await f.b.readGuidance({change_id:c.id});assert.equal(r.current.source_status,'withdrawn');assert.equal(r.history[0].source_status,'active');assert.equal(r.history[0].source_version,0);assert.equal(r.history[1].source_status,'withdrawn');assert.equal(r.history[1].source_version,1);
  assert.ok(!JSON.stringify(r.history).includes('Source body'));f.db.sqlite.close();
});

for(const target of ['history','activity'])test(`failed ${target} insertion rolls back the projection and lazily preserved legacy state`,async()=>{
  const f=await pair(),{c}=await proposed(f);f.db.sqlite.prepare("UPDATE changes SET status='accepted',adopted='Surviving old text',version=3 WHERE id=?").run(c.id);
  f.db.sqlite.exec(target==='history'?"CREATE TRIGGER fail BEFORE INSERT ON context_decisions WHEN NEW.channel='human' BEGIN SELECT RAISE(ABORT,'test rollback'); END":"CREATE TRIGGER fail BEFORE INSERT ON events WHEN NEW.kind='context' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  await assert.rejects(f.b.human('decide_context',decide(c.id,3,'pending')),/rollback/);
  assert.equal(count(f.db,'context_decisions'),0);const row=f.db.sqlite.prepare('SELECT version,adopted FROM changes WHERE id=?').get(c.id);assert.equal(row.version,3);assert.equal(row.adopted,'Surviving old text');f.db.sqlite.close();
});

test('additive history migration preserves only surviving legacy decisions without inventing actor or source state',async()=>{
  for(const status of ['accepted','declined','pending']){
    const db=database({through:'0004_skinny_colossus.sql'});
    // Independent grant-receipt fields are required by the current setup service.
    db.sqlite.exec(readFileSync(new URL('../drizzle/0006_melted_exodus.sql',import.meta.url),'utf8'));
  db.sqlite.exec(readFileSync(new URL('../drizzle/0007_tiny_sabra.sql',import.meta.url),'utf8'));
    const f=await pair(db),{c}=await proposed(f,true);
    db.sqlite.prepare('UPDATE changes SET status=?,adopted=?,version=4 WHERE id=?').run(status,status==='accepted'?'Known older wording':null,c.id);
    db.sqlite.exec(readFileSync(new URL('../drizzle/0005_calm_shadow_king.sql',import.meta.url),'utf8'));
    let r=await f.b.readGuidance({change_id:c.id});assert.equal(r.history.length,1);assert.equal(r.history[0].version,4);assert.equal(r.history[0].channel,'legacy');assert.equal(r.history[0].actor_id,null);assert.equal(r.history[0].source_status,null);assert.equal(count(db,'context_decisions'),0);
    await f.b.human('decide_context',decide(c.id,4,'pending'));r=await f.b.readGuidance({change_id:c.id});assert.deepEqual(r.history.map(x=>x.version),[4,5]);assert.equal(r.history[0].status,status);assert.equal(r.history[0].source_version,null);db.sqlite.close();
  }
});

test('guidance history paginates by version and checks current membership and profile on every page',async()=>{
  const f=await pair(),{c}=await proposed(f);for(let i=0;i<43;i++)await f.b.human('decide_context',decide(c.id,i,i%2?'pending':'accepted'));
  f.db.sqlite.prepare("UPDATE context_decisions SET created_at='2026-01-01T00:00:00.000Z'").run();let cursor,all=[];
  do{const r=await f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:c.id,limit:9,cursor});all.push(...r.history);cursor=r.next_cursor;assert.equal(r.current.can_decide,0);}while(cursor);
  assert.deepEqual(all.map(x=>x.version),Array.from({length:43},(_,i)=>i+1));
  const first=await f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:c.id,limit:1}),{c:other}=await proposed(f);
  await assert.rejects(f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:other.id,cursor:first.next_cursor}));
  await assert.rejects(f.a.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:c.id}));await assert.rejects(f.outsider.readGuidance({change_id:c.id}));
  f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
  await assert.rejects(f.b.agentTool('read_context_change',{agent_id:f.recipient.id,change_id:c.id,cursor:first.next_cursor}));
  assert.equal((await f.b.readGuidance({change_id:c.id})).current.can_decide,1);
  f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
  await assert.rejects(f.b.readGuidance({change_id:c.id}));await assert.rejects(f.b.human('decide_context',decide(c.id,0)));f.db.sqlite.close();
});

test('concurrent history reads return a consistent captured decision and recheck access at completion',async()=>{
  const f=await pair(),{c}=await proposed(f);await f.b.human('decide_context',decide(c.id,0));const original=f.b.all.bind(f.b);
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(sql.includes('FROM context_decisions d')){f.b.all=original;await f.b.human('decide_context',decide(c.id,1,'pending'));}return rows;};
  const old=await f.b.readGuidance({change_id:c.id});assert.equal(old.current.version,1);assert.equal(old.current.adopted,'Wording 0');assert.deepEqual(old.history.map(x=>x.version),[1]);
  assert.equal((await f.b.readGuidance({change_id:c.id})).current.status,'pending');
  f.b.all=async(sql,...args)=>{const rows=await original(sql,...args);if(sql.includes('FROM context_decisions d'))f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);return rows;};
  await assert.rejects(f.b.readGuidance({change_id:c.id}),{status:403});f.db.sqlite.close();
});

test('MCP exposes historical records with no authority to adopt them',async()=>{
  const f=await pair(),{c}=await proposed(f);await f.b.human('decide_context',decide(c.id,0));await f.b.human('decide_context',decide(c.id,1,'pending'));
  const request=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_context_change',arguments:{change_id:c.id,agent_id:f.recipient.id}}})});
  const result=(await(await handleMcpPost(request,async()=>f.b)).json()).result.structuredContent;assert.equal(result.history[0].adopted,'Wording 0');assert.equal(result.current.status,'pending');assert.equal(result.current.can_decide,0);assert.match(result.note,/not active instructions/);
  assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.length,0);await assert.rejects(f.b.agentTool('decide_context',{...decide(c.id,2),agent_id:f.recipient.id}),{status:404});f.db.sqlite.close();
});
