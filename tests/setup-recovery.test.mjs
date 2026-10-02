import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Workspace} from '../lib/workspace.ts';
import {database,pair} from './helpers/workspace.mjs';

const beforeBatch=(db,change)=>{const original=db.batch.bind(db);db.batch=async statements=>{db.batch=original;await change();return original(statements);};};
const records=(db,table)=>db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot=db=>Object.fromEntries(['spaces','agents','sources','members','events','creation_requests','invites'].map(t=>[t,records(db,t)]));
const inputs=f=>[
  ['create_space',{name:'New purpose',purpose:'Better decisions',topic:'Engineering',request_id:'setup-space'},'spaces'],
  ['add_agent',{name:'Personal assistant',provider:'Test',request_id:'setup-profile'},'agents'],
  ['add_source',{space_id:f.space.id,title:'Review note',content:'Read before choosing',kind:'Note',request_id:'setup-source'},'sources']
];
const inviteFor=(f,person=f.b)=>f.a.human('invite_member',{space_id:f.space.id,email:person.user.email,role:'advisor'});
const removeMember=(f,person=f.b)=>f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,person.user.id);

test('setup retries recover one normalized creation and reject changed payloads',async()=>{
  const f=await pair();
  for(const [action,args,table] of inputs(f)){
    const first=await f.a.human(action,args),expected=snapshot(f.db);
    assert.equal(first.replayed,false);
    const normalized={...args,[action==='add_source'?'title':'name']:' '+args[action==='add_source'?'title':'name']+' '};
    const retry=await f.a.human(action,normalized);assert.equal(retry.id,first.id);assert.equal(retry.recorded_at,first.recorded_at);assert.equal(retry.replayed,true);assert.deepEqual(snapshot(f.db),expected);
    await assert.rejects(f.a.human(action,{...args,[action==='add_source'?'content':'name']:'Different'}),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);
    assert.equal(records(f.db,table).filter(r=>r.id===first.id).length,1);
  }
  const receipts=records(f.db,'creation_requests');assert.equal(receipts.length,3);assert.ok(receipts.every(r=>r.actor_id==='mentor'&&r.request_hash.length===64&&!('content' in r)));f.db.sqlite.close();
});

test('setup references are scoped by authenticated person and operation',async()=>{
  const f=await pair();
  for(const [action,base] of inputs(f)){
    const args={...base,request_id:'shared-key'},a=await f.a.human(action,args),b=await f.b.human(action,args);assert.notEqual(a.id,b.id);
  }
  assert.equal(records(f.db,'creation_requests').length,6);f.db.sqlite.close();
});

test('competing identical setup requests create exactly one record and its side effects',async()=>{
  for(const index of [0,1,2]){
    const f=await pair(),[action,args]=inputs(f)[index];let winner,expected;
    beforeBatch(f.db,async()=>{winner=await f.a.human(action,args);expected=snapshot(f.db);});
    const retry=await f.a.human(action,args);assert.equal(retry.id,winner.id);assert.equal(retry.replayed,true);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('competing different setup payloads conflict without side effects',async()=>{
  for(const index of [0,1,2]){
    const f=await pair(),[action,args]=inputs(f)[index];let expected;
    beforeBatch(f.db,async()=>{await f.a.human(action,{...args,[index===2?'content':'name']:'Winning content'});expected=snapshot(f.db);});
    await assert.rejects(f.a.human(action,args),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('creation receipts never restore disconnected profiles or withdrawn sources',async()=>{
  const f=await pair();
  const [,agentArgs]=inputs(f)[1],profile=await f.a.human('add_agent',agentArgs);
  await f.a.human('disconnect_agent',{agent_id:profile.id});
  const [,sourceArgs]=inputs(f)[2],source=await f.a.human('add_source',sourceArgs);
  await f.a.human('set_source_state',{source_id:source.id,status:'withdrawn',expected_version:0});
  const expected=snapshot(f.db);assert.equal((await f.a.human('add_agent',agentArgs)).id,profile.id);assert.equal((await f.a.human('add_source',sourceArgs)).id,source.id);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});

test('receipt recovery after access loss never recreates resources or membership',async()=>{
  for(const index of [0,1,2]){
    const f=await pair(),[action,args]=inputs(f)[index],created=await f.a.human(action,args);
    if(index===1)f.db.sqlite.prepare("UPDATE agents SET owner_id='outsider' WHERE id=?").run(created.id);
    else f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(index===0?created.id:f.space.id,f.a.user.id);
    const expected=snapshot(f.db);await assert.rejects(f.a.human(action,args),e=>e.status===403);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('a competing creation followed by access loss returns no stale success or duplicate',async()=>{
  for(const index of [0,1,2]){
    const f=await pair(),[action,args]=inputs(f)[index];let expected;
    beforeBatch(f.db,async()=>{const created=await f.a.human(action,args);if(index===1)f.db.sqlite.prepare("UPDATE agents SET owner_id='outsider' WHERE id=?").run(created.id);else f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(index===0?created.id:f.space.id,f.a.user.id);expected=snapshot(f.db);});
    await assert.rejects(f.a.human(action,args),e=>e.status===403);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('source creation rechecks current membership inside the write',async()=>{
  const f=await pair(),[,args]=inputs(f)[2];let expected;
  beforeBatch(f.db,()=>{removeMember(f,f.a);expected=snapshot(f.db);});
  await assert.rejects(f.a.human('add_source',args),e=>e.status===403);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});

test('resource, membership, event and receipt roll back as one setup operation',async()=>{
  for(const [index,target] of [[0,'members'],[0,'events'],[0,'creation_requests'],[1,'creation_requests'],[2,'events'],[2,'creation_requests']]){
    const f=await pair(),[action,args]=inputs(f)[index],expected=snapshot(f.db);
    f.db.sqlite.exec(`CREATE TRIGGER setup_failure BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'injected setup failure'); END`);
    await assert.rejects(f.a.human(action,args),/injected setup failure/);assert.deepEqual(snapshot(f.db),expected);
    f.db.sqlite.exec('DROP TRIGGER setup_failure');assert.equal((await f.a.human(action,args)).replayed,false);f.db.sqlite.close();
  }
});

test('unkeyed setup remains deliberate new creation without invented receipts',async()=>{
  const f=await pair();for(const [action,args] of inputs(f)){delete args.request_id;assert.notEqual((await f.a.human(action,args)).id,(await f.a.human(action,args)).id);}assert.equal(records(f.db,'creation_requests').length,0);f.db.sqlite.close();
});

test('issuing an invitation rechecks owner and membership and rolls back its event',async()=>{
  for(const mode of ['owner','membership','event']){
    const f=await pair();let expected=snapshot(f.db);
    if(mode==='event')f.db.sqlite.exec("CREATE TRIGGER invitation_failure BEFORE INSERT ON events WHEN NEW.kind='invite' BEGIN SELECT RAISE(ABORT,'injected'); END");
    else beforeBatch(f.db,()=>{if(mode==='owner')f.db.sqlite.prepare("UPDATE spaces SET owner_id='recipient' WHERE id=?").run(f.space.id);else removeMember(f,f.a);expected=snapshot(f.db);});
    await assert.rejects(inviteFor(f));assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('same-person consumed invitations recover read-only across expiry, email and ownership changes',async()=>{
  const f=await pair();removeMember(f);const code=await inviteFor(f);const joined=await f.b.human('join_space',{code:code.code});assert.equal(joined.replayed,false);
  f.db.sqlite.exec("UPDATE invites SET expires_at='2000-01-01'; UPDATE spaces SET owner_id='outsider'");f.b.user={...f.b.user,email:'new-email@example.test'};
  const expected=snapshot(f.db);assert.equal((await f.b.human('join_space',{code:code.code})).replayed,true);assert.deepEqual(snapshot(f.db),expected);
  removeMember(f);const removed=snapshot(f.db);await assert.rejects(f.b.human('join_space',{code:code.code}));assert.deepEqual(snapshot(f.db),removed);f.db.sqlite.close();
});

test('competing joins recover only existing membership and cannot recreate removed access',async()=>{
  for(const remove of [false,true]){
    const f=await pair();removeMember(f);const code=await inviteFor(f);let expected;
    beforeBatch(f.db,async()=>{await f.b.human('join_space',{code:code.code});if(remove)removeMember(f);expected=snapshot(f.db);});
    if(remove)await assert.rejects(f.b.human('join_space',{code:code.code}));else assert.equal((await f.b.human('join_space',{code:code.code})).replayed,true);
    assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('invitation claims recheck issuer, membership, email, expiry and role at commit',async()=>{
  for(const mode of ['issuer','owner-member','email','expiry','role']){
    const f=await pair();removeMember(f);const code=await inviteFor(f);let expected;
    beforeBatch(f.db,()=>{
      if(mode==='issuer')f.db.sqlite.prepare("UPDATE spaces SET owner_id='outsider' WHERE id=?").run(f.space.id);
      else if(mode==='owner-member')removeMember(f,f.a);
      else f.db.sqlite.exec(mode==='email'?"UPDATE invites SET email='elsewhere@example.test' WHERE used_by IS NULL":mode==='expiry'?"UPDATE invites SET expires_at='2000-01-01' WHERE used_by IS NULL":"UPDATE invites SET role='owner' WHERE used_by IS NULL");
      expected=snapshot(f.db);
    });
    await assert.rejects(f.b.human('join_space',{code:code.code}));assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
  }
});

test('different people sharing an email cannot claim the same invitation',async()=>{
  const f=await pair();removeMember(f);const code=await inviteFor(f),other=new Workspace(f.db,{id:'other-person',email:f.b.user.email,name:'Other'});await other.bootstrap();let expected;
  beforeBatch(f.db,async()=>{await other.human('join_space',{code:code.code});expected=snapshot(f.db);});
  await assert.rejects(f.b.human('join_space',{code:code.code}));assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});

test('already-member invitations preserve role and do not invent join activity',async()=>{
  const f=await pair(),code=await inviteFor(f),events=records(f.db,'events');
  await f.b.human('join_space',{code:code.code});assert.equal(f.db.sqlite.prepare('SELECT role FROM members WHERE space_id=? AND user_id=?').get(f.space.id,f.b.user.id).role,'participant');assert.deepEqual(records(f.db,'events'),events);f.db.sqlite.close();
});

test('failed membership or join-event write rolls back invitation consumption',async()=>{
  for(const target of ['members','events']){
    const f=await pair();removeMember(f);const code=await inviteFor(f),expected=snapshot(f.db);
    f.db.sqlite.exec(`CREATE TRIGGER join_failure BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'injected join failure'); END`);
    await assert.rejects(f.b.human('join_space',{code:code.code}),/injected join failure/);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.exec('DROP TRIGGER join_failure');assert.equal((await f.b.human('join_space',{code:code.code})).replayed,false);f.db.sqlite.close();
  }
});

test('unused legacy codes need replacement; used legacy receipts require current membership',async()=>{
  const f=await pair(),code=await inviteFor(f);f.db.sqlite.exec('UPDATE invites SET created_by=NULL');const expected=snapshot(f.db);
  await assert.rejects(f.b.human('join_space',{code:code.code}),/older invitation/);assert.deepEqual(snapshot(f.db),expected);
  f.db.sqlite.prepare('UPDATE invites SET used_by=? WHERE used_by IS NULL').run(f.b.user.id);const used=snapshot(f.db);assert.equal((await f.b.human('join_space',{code:code.code})).replayed,true);assert.deepEqual(snapshot(f.db),used);
  removeMember(f);const removed=snapshot(f.db);await assert.rejects(f.b.human('join_space',{code:code.code}));assert.deepEqual(snapshot(f.db),removed);f.db.sqlite.close();
});

test('setup migration preserves existing records without fabricating receipts or issuers',()=>{
  const db=database({through:'0006_melted_exodus.sql'});
  db.sqlite.exec("INSERT INTO spaces VALUES ('s','p','Before','Purpose','Topic','2026-01-01'); INSERT INTO members VALUES ('s','p','owner'); INSERT INTO invites VALUES ('hash','s','old@example.test','advisor','2027-01-01',NULL)");
  const old=records(db,'invites')[0];db.sqlite.exec(readFileSync(new URL('../drizzle/0007_tiny_sabra.sql',import.meta.url),'utf8'));
  const after=records(db,'invites')[0];assert.equal(after.created_by,null);delete after.created_by;assert.deepEqual(after,old);assert.equal(records(db,'creation_requests').length,0);assert.equal(records(db,'members').length,1);db.sqlite.close();
});

test('a same-user join between receipt check and preflight read recovers its membership',async()=>{
  const f=await pair();removeMember(f);const code=await inviteFor(f);const one=f.b.one.bind(f.b);let expected;
  f.b.one=async(sql,...args)=>{if(sql==='SELECT * FROM invites WHERE code_hash=?'){f.b.one=one;await f.b.human('join_space',{code:code.code});expected=snapshot(f.db);}return one(sql,...args);};
  assert.equal((await f.b.human('join_space',{code:code.code})).replayed,true);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});
