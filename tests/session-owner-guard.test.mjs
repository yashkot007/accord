import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';

const input={name:'Original account draft',topic:'Synthetic',purpose:'Recover this exact session',request_id:'pinned-attempt'};
const snapshot=db=>Object.fromEntries(['people','spaces','members','events','creation_requests','invites'].map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const header=(workspace,space,expected)=>{workspace.assertExpectedOwner(expected);return workspace.member(space);};

function forbidDomainSql(workspace) {
  let calls=0;
  const stmt=workspace.stmt.bind(workspace);
  workspace.stmt=()=>{calls++;assert.fail('the owner precondition must reject before any domain SQL');};
  return {get calls(){return calls;},restore(){workspace.stmt=stmt;}};
}

test('A-to-B account switch before creation produces no B record, receipt, activity or domain read',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const before=snapshot(f.db),sql=forbidDomainSql(f.b);
  await assert.rejects(f.b.human('create_space',{...input,expected_owner_id:f.a.user.id}),error=>error.status===403&&/signed-in account changed/.test(error.message));
  assert.equal(sql.calls,0);sql.restore();assert.deepEqual(snapshot(f.db),before);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM creation_requests WHERE actor_id=? AND request_key=?').get(f.b.user.id,input.request_id).n,0);
});

test('A-to-B account switch before joining cannot redeem even an invitation otherwise valid for B',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const room=await f.a.human('create_space',{...input,request_id:'invitation-room'});
  const invitation=await f.a.human('invite_member',{space_id:room.id,email:f.b.user.email,role:'participant'});
  const before=snapshot(f.db),sql=forbidDomainSql(f.b);
  await assert.rejects(f.b.human('join_space',{code:invitation.code,expected_owner_id:f.a.user.id}),{status:403});
  assert.equal(sql.calls,0);sql.restore();assert.deepEqual(snapshot(f.db),before);
  assert.equal(f.db.sqlite.prepare('SELECT used_by FROM invites WHERE space_id=?').get(room.id).used_by,null);
  const joined=await f.b.human('join_space',{code:invitation.code,expected_owner_id:f.b.user.id});
  assert.equal(joined.id,room.id,'the pin validates the actor without changing normal invitation access');
});

test('known-room opening checks its original actor before reading, even when B has ordinary room access',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());
  assert.equal((await f.b.member(f.space.id)).id,f.space.id);
  const before=snapshot(f.db),sql=forbidDomainSql(f.b);
  await assert.rejects(async()=>header(f.b,f.space.id,f.a.user.id),{status:403});
  assert.equal(sql.calls,0);sql.restore();assert.deepEqual(snapshot(f.db),before);
  assert.equal((await header(f.b,f.space.id,f.b.user.id)).id,f.space.id);
  await assert.rejects(async()=>header(f.outsider,f.space.id,f.outsider.user.id),{status:403},'matching the actor never confers membership');
});

test('matching actor pins preserve request receipts, and omitted pins preserve old clients',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const args={...input,expected_owner_id:f.a.user.id};
  const first=await f.a.human('create_space',args),after=snapshot(f.db);
  assert.equal((await f.a.human('create_space',args)).id,first.id);assert.deepEqual(snapshot(f.db),after);
  assert.equal((await f.a.human('create_space',input)).id,first.id);assert.deepEqual(snapshot(f.db),after);
  assert.equal((await header(f.a,first.id,undefined)).id,first.id);
  const old=await f.b.human('create_space',{...input,request_id:'older-unpinned-client'});
  assert.equal((await f.b.member(old.id)).owner_id,f.b.user.id);
});

test('malformed supplied owner pins fail before dispatch, while only undefined omits the check',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const before=snapshot(f.db),sql=forbidDomainSql(f.a);
  for(const expected of [null,'','   ',12,{},[],true]) {
    await assert.rejects(f.a.human('create_space',{...input,expected_owner_id:expected}),{status:400});
    assert.throws(()=>f.a.assertExpectedOwner(expected),{status:400});
  }
  await assert.rejects(f.a.human('create_space',{...input,expected_owner_id:' '+f.a.user.id}),{status:403},'pins compare exact identity rather than normalizing it');
  assert.equal(sql.calls,0);sql.restore();assert.deepEqual(snapshot(f.db),before);
  f.a.assertExpectedOwner(undefined);f.a.assertExpectedOwner(f.a.user.id);
});
