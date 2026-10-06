import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AccordHost} from '../lib/host.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {database,pair} from './helpers/workspace.mjs';
const beforeBatch=(db,change)=>{const batch=db.batch.bind(db);db.batch=async writes=>{db.batch=batch;await change();return batch(writes);};};
const rows=(db,table)=>db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot=db=>Object.fromEntries(['spaces','members','membership_changes','agents','space_agents','grants','invites','sources','changes','events'].map(t=>[t,rows(db,t)]));
const member=(f,user=f.b)=>f.db.sqlite.prepare('SELECT * FROM members WHERE space_id=? AND user_id=?').get(f.space.id,user.user.id);
const version=f=>f.db.sqlite.prepare('SELECT membership_version FROM spaces WHERE id=?').get(f.space.id).membership_version;
const args=(f,actor=f.a,target=f.b,key=crypto.randomUUID())=>({space_id:f.space.id,user_id:target.user.id,expected_membership_key:member(f,target)?.membership_key||'missing',expected_space_version:version(f),request_id:key});
const invite=(f,person=f.b,owner=f.a)=>owner.human('invite_member',{space_id:f.space.id,email:person.user.email,role:'participant'});
async function evidence(f){
 const source=await f.b.human('add_source',{space_id:f.space.id,title:'Shared background',content:'Operational experience.',kind:'Note'});
 const c=await f.a.human('propose_context_change',{grant_id:f.grant.id,title:'Review first',instruction:'Review evidence before selecting a tool.',reason:'Keep the decision explicit.',source_id:source.id});
 await f.b.human('decide_context',{change_id:c.id,expected_version:0,expected_source_version:0,decision:'accepted',instruction:'Review evidence before selecting a tool.'});
 const task=await f.a.human('send_instruction',{grant_id:f.grant.id,title:'Trace the decision',body:'State the evidence.'});return {source,c,task};
}

test('leaving removes space access, revokes authority and detaches profiles while preserving shared and private records',async()=>{
 const f=await pair(),e=await evidence(f),host=new AccordHost(f.b);
 const visit=await host.perform('arrive_at_accord',{purpose:'Private purpose',service:'perspective',agent_id:f.recipient.id,request_id:'private'});
 await host.perform('enter_room',{visit_id:visit.visit.id,space_id:f.space.id});
 const other=await f.b.human('create_space',{name:'Elsewhere',purpose:'Separate',topic:'Other'});await f.b.human('attach_agent',{space_id:other.id,agent_id:f.recipient.id});
 const profile=rows(f.db,'agents').find(a=>a.id===f.recipient.id),a=args(f,f.b),result=await f.b.human('leave_space',a);assert.equal(result.replayed,false);assert.equal(member(f),undefined);assert.equal(version(f),1);
 assert.equal(rows(f.db,'grants').find(g=>g.id===f.grant.id).status,'revoked');assert.equal(rows(f.db,'space_agents').filter(a=>a.space_id===f.space.id&&a.agent_id===f.recipient.id).length,0);assert.deepEqual(rows(f.db,'agents').find(a=>a.id===f.recipient.id),profile);assert.ok(rows(f.db,'space_agents').some(a=>a.space_id===other.id&&a.agent_id===f.recipient.id));
 await assert.rejects(f.b.readSpace(f.space.id),e=>e.status===403);await assert.rejects(f.b.readSource(e.source.id),e=>e.status===403);await assert.rejects(f.b.readTask({task_id:e.task.id}),e=>e.status===403);
 assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.length,0);const shared=await f.a.readSpace(f.space.id);assert.equal(shared.sources[0].content,'Operational experience.');assert.equal(shared.changes[0].status,'accepted');assert.equal(shared.tasks.length,1);
 f.db.sqlite.prepare("UPDATE spaces SET name='New private name' WHERE id=?").run(f.space.id);
 assert.equal((await host.arrivals()).visits[0].room_name,null);assert.equal((await host.perform('consult_host',{visit_id:visit.visit.id})).room,null);
 const closed=await host.perform('leave_accord',{visit_id:visit.visit.id,outcome:'Closed after leaving.'});assert.equal(closed.receipt.outcome,'Closed after leaving.');assert.equal((await f.b.bootstrap()).spaces.some(s=>s.id===f.space.id),false);f.db.sqlite.close();
});

test('removal blocks every earlier admission for that account but preserves unrelated invitations',async()=>{
 const f=await pair(),old=await invite(f),other=await invite(f,f.outsider);const alt={user:{...f.b.user,email:'changed@example.test'}},alias=await invite(f,alt);
 await f.a.human('remove_member',args(f));await assert.rejects(f.b.human('join_space',{code:old.code}));f.b.user=alt.user;await f.b.bootstrap();await assert.rejects(f.b.human('join_space',{code:alias.code}));
 await f.outsider.human('join_space',{code:other.code});assert.ok(member(f,f.outsider));assert.equal(member(f),undefined);
 const fresh=await invite(f);await f.b.human('join_space',{code:fresh.code});assert.ok(member(f));assert.equal(rows(f.db,'grants')[0].status,'revoked');assert.equal(rows(f.db,'space_agents').filter(a=>a.agent_id===f.recipient.id).length,0);f.db.sqlite.close();
});

test('rejoin needs deliberate reattachment and never restores old authority; historical removal retry has no side effects',async()=>{
 const f=await pair();await evidence(f);const oldMembership=member(f).membership_key,a=args(f);await f.a.human('remove_member',a);
 const fresh=await invite(f);await f.b.human('join_space',{code:fresh.code});assert.notEqual(member(f).membership_key,oldMembership);
 assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.length,0);
 await f.b.human('attach_agent',{space_id:f.space.id,agent_id:f.recipient.id});assert.equal((await f.b.agentTool('read_context',{agent_id:f.recipient.id})).context.length,1);assert.equal((await f.b.agentTool('read_inbox',{agent_id:f.recipient.id})).instructions.length,0);
 const replacement=await f.b.human('grant_authority',{space_id:f.space.id,from_agent:f.sender.id,to_agent:f.recipient.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
 const expected=snapshot(f.db);assert.equal((await f.a.human('remove_member',a)).replayed,true);assert.deepEqual(snapshot(f.db),expected);
 await assert.rejects(f.a.human('remove_member',{...a,request_id:'stale-new-key'}),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);assert.equal(rows(f.db,'grants').find(g=>g.id===replacement.id).status,'active');f.db.sqlite.close();
});

test('receipt keys reject changed decisions and recover departure after membership is gone',async()=>{
 const f=await pair(),a=args(f,f.b);const first=await f.b.human('leave_space',a),expected=snapshot(f.db),again=await f.b.human('leave_space',a);assert.equal(again.id,first.id);assert.equal(again.replayed,true);assert.deepEqual(snapshot(f.db),expected);
 for(const patch of [{expected_membership_key:'different'},{expected_space_version:10},{space_id:'other'}])await assert.rejects(f.b.human('leave_space',{...a,...patch}),e=>e.status===409);
 await assert.rejects(f.b.human('remove_member',a),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});

test('simultaneous leave/removal decisions commit once and later competing requests cannot clean up again',async()=>{
 for(const same of [false,true]){
 const f=await pair(),a=args(f),b=args(f,f.b);let expected;
 beforeBatch(f.db,async()=>{await (same?f.a:f.b).human(same?'remove_member':'leave_space',same?a:b);expected=snapshot(f.db);});
 if(same)assert.equal((await f.a.human('remove_member',a)).replayed,true);else await assert.rejects(f.a.human('remove_member',a),e=>e.status===409);
 assert.deepEqual(snapshot(f.db),expected);assert.equal(rows(f.db,'membership_changes').length,1);f.db.sqlite.close();}
});

test('same-key winner between receipt and preflight checks recovers leave and transfer',async()=>{
 for(const action of ['leave_space','transfer_ownership']){
 const f=await pair(),actor=action==='leave_space'?f.b:f.a,a=args(f,actor);const original=actor.member.bind(actor);let expected;
 actor.member=async(...input)=>{actor.member=original;await actor.human(action,a);expected=snapshot(f.db);return original(...input);};
 const result=await actor.human(action,a);assert.equal(result.replayed,true);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();}
});

test('ownership transfer enables departure without changing personal agent authority',async()=>{
 const f=await pair(),oldCode=await invite(f,f.outsider),before=rows(f.db,'grants'),a=args(f);const r=await f.a.human('transfer_ownership',a);
 assert.equal((await f.b.member(f.space.id)).owner_id,f.b.user.id);assert.equal(member(f).role,'owner');assert.equal(member(f,f.a).role,'participant');assert.deepEqual(rows(f.db,'grants'),before);
 await assert.rejects(f.a.human('invite_member',{space_id:f.space.id,email:f.outsider.user.email,role:'participant'}),e=>e.status===403);await assert.rejects(f.outsider.human('join_space',{code:oldCode.code}));
 const fresh=await invite(f,f.outsider,f.b);await f.outsider.human('join_space',{code:fresh.code});
 await f.a.human('leave_space',args(f,f.a,f.a));assert.equal(member(f,f.a),undefined);assert.equal((await f.a.human('transfer_ownership',a)).id,r.id);assert.equal(member(f).role,'owner');f.db.sqlite.close();
});

test('transfer back never revives old invitations or replays an old transfer',async()=>{
 const f=await pair(),old=await invite(f,f.outsider),a=args(f);await f.a.human('transfer_ownership',a);await f.b.human('transfer_ownership',args(f,f.b,f.a));
 const expected=snapshot(f.db);assert.equal((await f.a.human('transfer_ownership',a)).replayed,true);assert.deepEqual(snapshot(f.db),expected);await assert.rejects(f.outsider.human('join_space',{code:old.code}));
 await assert.rejects(f.a.human('transfer_ownership',{...a,request_id:'old-review-new-key'}),e=>e.status===409);assert.equal((await f.a.member(f.space.id)).owner_id,f.a.user.id);f.db.sqlite.close();
});

test('only the current owner can remove/transfer, owners cannot leave, and profiles expose no membership tools',async()=>{
 const f=await pair(),expected=snapshot(f.db);await assert.rejects(f.a.human('leave_space',args(f,f.a,f.a)),e=>e.status===403);
 for(const actor of [f.b,f.outsider])for(const action of ['remove_member','transfer_ownership'])await assert.rejects(actor.human(action,args(f,actor)),e=>e.status===403);
 await assert.rejects(f.a.human('remove_member',{...args(f),expected_membership_key:undefined}));await assert.rejects(f.a.human('remove_member',{...args(f),expected_space_version:-1}));
 for(const name of ['leave_space','remove_member','transfer_ownership']){
 const request=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args(f)}})});let resolved=false;const result=await(await handleMcpPost(request,async()=>{resolved=true;return f.a;})).json();assert.equal(resolved,false);assert.ok(result.error||result.result?.isError);}
 assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();
});

test('membership changes recheck current actor, target generation, owner and reviewed revision at commit',async()=>{
 for(const mutation of ['actor-member','owner','target-owner','target-generation','version']){
 const f=await pair(),a=args(f);let expected;
 beforeBatch(f.db,()=>{if(mutation==='actor-member')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);else if(mutation==='owner'||mutation==='target-owner')f.db.sqlite.prepare('UPDATE spaces SET owner_id=? WHERE id=?').run(mutation==='owner'?f.outsider.user.id:f.b.user.id,f.space.id);else if(mutation==='target-generation')f.db.sqlite.prepare("UPDATE members SET membership_key='new-generation' WHERE space_id=? AND user_id=?").run(f.space.id,f.b.user.id);else f.db.sqlite.prepare('UPDATE spaces SET membership_version=membership_version+1 WHERE id=?').run(f.space.id);expected=snapshot(f.db);});
 await assert.rejects(f.a.human('remove_member',a),e=>e.status===409);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.close();}
});

test('every departure and transfer write rolls back with its receipt, access version and event',async()=>{
 for(const [action,table,operation] of [['remove_member','membership_changes','INSERT'],['remove_member','spaces','UPDATE'],['remove_member','members','DELETE'],['remove_member','grants','UPDATE'],['remove_member','space_agents','DELETE'],['remove_member','events','INSERT'],['transfer_ownership','members','UPDATE'],['transfer_ownership','events','INSERT']]){
 const f=await pair(),a=args(f),expected=snapshot(f.db);f.db.sqlite.exec(`CREATE TRIGGER membership_failure BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'injected membership failure'); END`);
 await assert.rejects(f.a.human(action,a),/injected membership failure/);assert.deepEqual(snapshot(f.db),expected);f.db.sqlite.exec('DROP TRIGGER membership_failure');await f.a.human(action,a);f.db.sqlite.close();}
});

test('invitation acceptance crossing a removal cannot regain membership',async()=>{
 const f=await pair(),code=await invite(f);beforeBatch(f.db,()=>f.a.human('remove_member',args(f)));await assert.rejects(f.b.human('join_space',{code:code.code}));assert.equal(member(f),undefined);assert.equal(rows(f.db,'membership_changes').length,1);f.db.sqlite.close();
});

test('invitation issuance after a departure boundary receives the new admission version',async()=>{
 const f=await pair();beforeBatch(f.db,()=>f.a.human('remove_member',args(f)));const fresh=await invite(f);await f.b.human('join_space',{code:fresh.code});assert.ok(member(f));assert.equal(rows(f.db,'invites').at(-1).issued_version,1);f.db.sqlite.close();
});

test('space reads cannot return shared data when membership disappears during collection',async()=>{
 const f=await pair();await evidence(f);const a=args(f),original=f.b.all.bind(f.b);let removed=false;
 f.b.all=async(sql,...values)=>{const result=await original(sql,...values);if(!removed&&sql.includes('SELECT * FROM tasks')){removed=true;await f.a.human('remove_member',a);}return result;};
 await assert.rejects(f.b.readSpace(f.space.id),e=>e.status===403);f.db.sqlite.close();
});

test('agent context fails closed when current access changes between sizing and detail queries',async()=>{
 for(const change of ['disconnect','owner','attachment']){
 const f=await pair();await evidence(f);const original=f.b.all.bind(f.b);let changed=false,contactAtBoundary;
 const contact=()=>f.db.sqlite.prepare('SELECT contact_version,last_seen_at FROM agents WHERE id=?').get(f.recipient.id);
 f.b.all=async(sql,...values)=>{if(!changed&&sql.includes('c.adopted AS instruction')){changed=true;contactAtBoundary=contact();if(change==='disconnect')f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id);else if(change==='owner')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id);else f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);}return original(sql,...values);};
 // Sizing already selected this record. A recoverable conflict prevents an empty
 // page from skipping it while ensuring the second query returns no private data.
 await assert.rejects(f.b.agentTool('read_context',{agent_id:f.recipient.id}),error=>error.status===409&&/records or their access changed/.test(error.message));
 assert.equal(changed,true);assert.deepEqual(contact(),contactAtBoundary);
 if(change==='attachment'){const retry=await f.b.agentTool('read_context',{agent_id:f.recipient.id});assert.deepEqual(retry.context,[]);assert.equal(retry.next_cursor,null);}
 else await assert.rejects(f.b.agentTool('read_context',{agent_id:f.recipient.id}),error=>error.status===403);
 assert.deepEqual(contact(),contactAtBoundary);f.db.sqlite.close();}
});

test('membership preview is authorized, pins the reviewed instance, and rejects concurrent changes',async()=>{
 const f=await pair(),p=await f.a.readMembership({space_id:f.space.id,user_id:f.b.user.id});assert.equal(p.can_remove,true);assert.equal(p.can_transfer,true);assert.equal(p.member.membership_key,member(f).membership_key);assert.equal((await f.b.readMembership({space_id:f.space.id,user_id:f.b.user.id})).can_leave,true);await assert.rejects(f.outsider.readMembership({space_id:f.space.id,user_id:f.b.user.id}),e=>e.status===403);
 const original=f.a.one.bind(f.a);let changed=false;f.a.one=async(sql,...values)=>{const r=await original(sql,...values);if(!changed&&sql.includes('SELECT m.user_id')){changed=true;await f.a.human('remove_member',args(f));}return r;};await assert.rejects(f.a.readMembership({space_id:f.space.id,user_id:f.b.user.id}),e=>e.status===409);f.db.sqlite.close();
});

test('membership migration is additive and does not invent earlier departures or issuers',()=>{
 const db=database({through:'0007_tiny_sabra.sql'});db.sqlite.exec("INSERT INTO spaces VALUES ('s','p','Before','Purpose','Topic','2026-01-01'); INSERT INTO members VALUES ('s','p','owner'); INSERT INTO invites VALUES ('hash','s','a@example.test','participant','2027-01-01',NULL,'p')");
 db.sqlite.exec(readFileSync(new URL('../drizzle/0008_complex_spencer_smythe.sql',import.meta.url),'utf8'));assert.equal(rows(db,'members')[0].membership_key,'legacy');assert.equal(rows(db,'spaces')[0].membership_version,0);assert.equal(rows(db,'invites')[0].issued_version,0);assert.equal(rows(db,'membership_changes').length,0);db.sqlite.close();
});

test('removal revokes both directions only in its own space',async()=>{
 const f=await pair();
 await f.a.human('grant_authority',{space_id:f.space.id,from_agent:f.recipient.id,to_agent:f.sender.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
 const other=await f.a.human('create_space',{name:'Independent',purpose:'Another relationship',topic:'Other'}),code=await f.a.human('invite_member',{space_id:other.id,email:f.b.user.email,role:'participant'});await f.b.human('join_space',{code:code.code});
 await f.a.human('attach_agent',{space_id:other.id,agent_id:f.sender.id});await f.b.human('attach_agent',{space_id:other.id,agent_id:f.recipient.id});
 const retained=await f.b.human('grant_authority',{space_id:other.id,from_agent:f.sender.id,to_agent:f.recipient.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
 await f.a.human('remove_member',args(f));assert.equal(rows(f.db,'grants').filter(g=>g.space_id===f.space.id&&g.status==='revoked').length,2);assert.equal(rows(f.db,'grants').find(g=>g.id===retained.id).status,'active');await f.b.agentAccess(other.id,f.recipient.id);f.db.sqlite.close();
});
