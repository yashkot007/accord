import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {Workspace} from '../lib/workspace.ts';

test('account setup exposes only the signed-in owner’s active assistant availability',async()=>{
  const f=await pair();try{
    const before=f.db.sqlite.prepare('SELECT last_seen_at,contact_version FROM agents WHERE id=?').get(f.sender.id);
    const eventCount=f.db.sqlite.prepare('SELECT count(*) AS count FROM events').get().count;
    const global=await f.a.humanSetup();
    assert.deepEqual(Object.keys(global).sort(),['has_profiles','user']);
    assert.equal(global.user.id,f.a.user.id);assert.equal(global.has_profiles,true);
    const own=await f.a.humanProfile(f.sender.id);assert.equal(own.profile.id,f.sender.id);assert.equal(own.profile.provider,'Test');
    await assert.rejects(f.a.humanProfile(f.recipient.id),{status:403});
    assert.equal((await f.outsider.humanSetup()).has_profiles,false,'another owner’s assistants do not count');
    await f.a.human('disconnect_agent',{agent_id:f.sender.id});
    assert.equal((await f.a.humanSetup()).has_profiles,false,'disconnected assistants cannot be selected again');
    await assert.rejects(f.a.humanProfile(f.sender.id),{status:403});
    assert.deepEqual(f.db.sqlite.prepare('SELECT last_seen_at,contact_version FROM agents WHERE id=?').get(f.sender.id),before);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS count FROM events').get().count,eventCount);
  }finally{f.db.sqlite.close();}
});

test('account setup initializes a new signed-in person without loading or joining any room',async()=>{
  const f=await pair();try{
    const user={id:'new-owner',name:'New owner',email:'new@example.test'},workspace=new Workspace(f.db,user);
    const setup=await workspace.humanSetup();assert.equal(setup.has_profiles,false);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS count FROM members WHERE user_id=?').get(user.id).count,0);
    const assistant=await workspace.human('add_agent',{name:'My assistant',provider:'Remote MCP assistant',request_id:'new-owner-assistant'});
    assert.equal((await workspace.humanSetup()).has_profiles,true);
    assert.equal((await workspace.humanProfile(assistant.id)).profile.status,'pending');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS count FROM space_agents WHERE agent_id=?').get(assistant.id).count,0);
  }finally{f.db.sqlite.close();}
});

test('room setup still rejects missing or concurrently removed membership',async()=>{
  const f=await pair();try{
    await assert.rejects(f.outsider.humanSetup(f.space.id),{status:403});
    const one=f.b.one.bind(f.b);let removed=false;
    f.b.one=async(sql,...args)=>{
      const result=await one(sql,...args);
      if(!removed&&sql.includes('SELECT EXISTS(SELECT 1 FROM agents')){
        removed=true;f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
      }
      return result;
    };
    await assert.rejects(f.b.humanSetup(f.space.id),{status:403});assert.equal(removed,true);
  }finally{f.db.sqlite.close();}
});
