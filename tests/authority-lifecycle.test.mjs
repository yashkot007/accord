import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../lib/workspace.ts';
import {database,pair} from './helpers/workspace.mjs';

const argsFor=f=>({space_id:f.space.id,from_agent:f.sender.id,to_agent:f.recipient.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString(),request_id:'permission-request'});
const rows=db=>db.sqlite.prepare('SELECT * FROM grants ORDER BY id').all();
const events=db=>db.sqlite.prepare("SELECT * FROM events WHERE kind='authority' ORDER BY id").all();
const snapshot=db=>({grants:rows(db),events:events(db)});
const beforeBatch=(db,change)=>{const original=db.batch.bind(db);db.batch=async statements=>{db.batch=original;await change();return original(statements);};};

test('saved grant retries never restore revoked, expired, replaced or disconnected authority',async()=>{
  const f=await pair(),a=argsFor(f),created=await f.b.human('grant_authority',a);
  assert.equal(created.replayed,false);
  assert.equal(rows(f.db).find(x=>x.id===f.grant.id).status,'revoked');
  const first=snapshot(f.db),retried=await f.b.human('grant_authority',a);
  assert.equal(retried.id,created.id);assert.equal(retried.recorded_at,created.recorded_at);assert.equal(retried.replayed,true);assert.deepEqual(snapshot(f.db),first);
  await f.b.human('revoke_authority',{grant_id:created.id});
  let expected=snapshot(f.db);assert.equal((await f.b.human('grant_authority',a)).id,created.id);assert.deepEqual(snapshot(f.db),expected);
  const replacement=await f.b.human('grant_authority',{...a,request_id:'replacement',allow_assign:false});
  expected=snapshot(f.db);assert.equal((await f.b.human('grant_authority',a)).id,created.id);assert.deepEqual(snapshot(f.db),expected);
  assert.equal(rows(f.db).filter(g=>g.status==='active').length,1);assert.equal(rows(f.db).find(g=>g.status==='active').id,replacement.id);
  const clock=Date.now;try{Date.now=()=>Date.parse(a.expires_at)+1000;assert.equal((await f.b.human('grant_authority',a)).id,created.id);await assert.rejects(f.b.human('grant_authority',{...a,request_id:'new-expired'}));}finally{Date.now=clock;}
  await f.b.human('disconnect_agent',{agent_id:f.recipient.id});await f.a.human('disconnect_agent',{agent_id:f.sender.id});
  expected=snapshot(f.db);assert.equal((await f.b.human('grant_authority',a)).id,created.id);assert.deepEqual(snapshot(f.db),expected);
  f.db.sqlite.close();
});

test('grant request references reject changed content and remain scoped to the issuing person',async()=>{
  const f=await pair(),a=argsFor(f);await f.b.human('grant_authority',a);const expected=snapshot(f.db);
  for(const change of [{allow_assign:false},{allow_context:false},{space_id:'different'},{from_agent:'different'},{to_agent:'different'},{expires_at:new Date(Date.now()+2*86400000).toISOString()}]){
    await assert.rejects(f.b.human('grant_authority',{...a,...change}),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);
  }
  await assert.rejects(f.outsider.human('grant_authority',a));assert.deepEqual(snapshot(f.db),expected);
  const reverse=await f.a.human('grant_authority',{...a,from_agent:f.recipient.id,to_agent:f.sender.id});assert.notEqual(reverse.id,rows(f.db).find(g=>g.issued_by===f.b.user.id).id);
  f.db.sqlite.close();
});

test('competing identical grant submission returns one issuance without a second event',async()=>{
  const f=await pair(),a=argsFor(f);let winner;
  beforeBatch(f.db,async()=>{winner=await f.b.human('grant_authority',a);});
  const loser=await f.b.human('grant_authority',a);
  assert.equal(loser.id,winner.id);assert.equal(loser.replayed,true);
  assert.equal(rows(f.db).filter(g=>g.request_key===a.request_id).length,1);
  assert.equal(events(f.db).filter(e=>e.description==='Granted scoped authority to an agent').length,2);
  f.db.sqlite.close();
});

test('a competing request with changed content leaves the winning grant untouched',async()=>{
  const f=await pair(),a=argsFor(f);let winner;
  beforeBatch(f.db,async()=>{winner=await f.b.human('grant_authority',{...a,allow_assign:false});});
  await assert.rejects(f.b.human('grant_authority',a),e=>e.status===409);
  const active=rows(f.db).filter(g=>g.status==='active');assert.equal(active.length,1);assert.equal(active[0].id,winner.id);assert.equal(active[0].allow_assign,0);
  f.db.sqlite.close();
});

test('new grant checks both owners, profiles and attachments at commit without revoking an old grant',async()=>{
  const mutations=[
    f=>f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id),
    f=>f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id),
    f=>f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.sender.id),
    f=>f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id),
    f=>f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.sender.id),
    f=>f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id),
    f=>f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id),
    f=>f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.sender.id)
  ];
  for(const mutate of mutations){const f=await pair(),expected=snapshot(f.db);beforeBatch(f.db,()=>mutate(f));await assert.rejects(f.b.human('grant_authority',argsFor(f)),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();}
});

test('grant history recovery requires current recipient ownership and membership',async()=>{
  for(const mode of ['membership','ownership']){const f=await pair(),a=argsFor(f);await f.b.human('grant_authority',a);const expected=snapshot(f.db);
    if(mode==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
    else f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id);
    await assert.rejects(f.b.human('grant_authority',a),e=>e.status===403);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('grant issuance and prior revocation roll back together when either later write fails',async()=>{
  for(const target of ['event','replacement']){const f=await pair(),a=argsFor(f),expected=snapshot(f.db);
    const sql=target==='event'?"CREATE TRIGGER fail_grant_event BEFORE INSERT ON events WHEN NEW.kind='authority' BEGIN SELECT RAISE(ABORT,'injected'); END":"CREATE TRIGGER fail_replacement BEFORE UPDATE ON grants WHEN NEW.status='revoked' BEGIN SELECT RAISE(ABORT,'injected'); END";
    f.db.sqlite.exec(sql);await assert.rejects(f.b.human('grant_authority',a),/injected/);assert.deepEqual(snapshot(f.db),expected);
    f.db.sqlite.exec('DROP TRIGGER '+(target==='event'?'fail_grant_event':'fail_replacement'));
    const saved=await f.b.human('grant_authority',a);assert.equal(saved.replayed,false);f.db.sqlite.close();
  }
});

test('attach is duplicate-safe and cannot succeed after commit-time loss of authority',async()=>{
  const f=await pair(),count=()=>f.db.sqlite.prepare("SELECT count(*) AS n FROM events WHERE kind='agent'").get().n;
  const expected=count();await f.b.human('attach_agent',{space_id:f.space.id,agent_id:f.recipient.id});assert.equal(count(),expected);
  for(const mode of ['member','owner','status']){
    const profile=await f.b.human('add_agent',{name:'Next '+mode,provider:'Test'});
    beforeBatch(f.db,()=>mode==='member'?f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id):f.db.sqlite.prepare(mode==='owner'?"UPDATE agents SET owner_id='outsider' WHERE id=?":"UPDATE agents SET status='revoked' WHERE id=?").run(profile.id));
    await assert.rejects(f.b.human('attach_agent',{space_id:f.space.id,agent_id:profile.id}));
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM space_agents WHERE agent_id=?').get(profile.id).n,0);assert.equal(count(),expected);
    if(mode==='member')f.db.sqlite.prepare("INSERT INTO members VALUES (?,?,'participant')").run(f.space.id,f.b.user.id);
  }
  f.db.sqlite.close();
});

test('revocation is duplicate-safe, preserves replacement grants and permits disconnected recipients',async()=>{
  const f=await pair();await f.b.human('revoke_authority',{grant_id:f.grant.id});const first=snapshot(f.db);
  await f.b.human('revoke_authority',{grant_id:f.grant.id});assert.deepEqual(snapshot(f.db),first);
  const replacement=await f.b.human('grant_authority',argsFor(f)),expected=snapshot(f.db);
  await f.b.human('revoke_authority',{grant_id:f.grant.id});assert.deepEqual(snapshot(f.db),expected);
  await f.b.human('disconnect_agent',{agent_id:f.recipient.id});await f.b.human('revoke_authority',{grant_id:replacement.id});
  assert.equal(rows(f.db).find(g=>g.id===replacement.id).status,'revoked');f.db.sqlite.close();
});

test('revocation and disconnection recheck ownership at the write boundary',async()=>{
  for(const mode of ['member','owner']){const f=await pair(),expected=snapshot(f.db);
    beforeBatch(f.db,()=>mode==='member'?f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id):f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id));
    await assert.rejects(f.b.human('revoke_authority',{grant_id:f.grant.id}),e=>e.status===403);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
  const f=await pair(),original=f.b.ownedAgent.bind(f.b);
  f.b.ownedAgent=async(...args)=>{const profile=await original(...args);f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,profile.id);return profile;};
  await assert.rejects(f.b.human('disconnect_agent',{agent_id:f.recipient.id}),e=>e.status===403);
  assert.notEqual(f.db.sqlite.prepare('SELECT status FROM agents WHERE id=?').get(f.recipient.id).status,'revoked');
  f.db.sqlite.close();
});

test('additive grant migration preserves historical permissions without invented request evidence',async()=>{
  const db=database({through:'0005_calm_shadow_king.sql'});
  db.sqlite.exec("INSERT INTO spaces VALUES ('s','p','Test','Purpose','Topic','2026-01-01'); INSERT INTO agents VALUES ('a','p','Sender','Test','pending',NULL,'2026-01-01'); INSERT INTO agents VALUES ('b','p','Recipient','Test','pending',NULL,'2026-01-01'); INSERT INTO grants VALUES ('g','s','a','b','Topic',1,0,'active','2027-01-01','2026-01-01')");
  const {readFileSync}=await import('node:fs');db.sqlite.exec(readFileSync(new URL('../drizzle/0006_melted_exodus.sql',import.meta.url),'utf8'));
  const g=rows(db)[0];assert.equal(g.status,'active');assert.equal(g.allow_assign,1);assert.equal(g.issued_by,null);assert.equal(g.request_key,null);assert.equal(g.request_hash,null);db.sqlite.close();
});
