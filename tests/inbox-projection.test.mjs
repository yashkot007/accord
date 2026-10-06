import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {agentTools} from '../lib/agent-tools.ts';
import {agentInstructions} from '../lib/agent-instructions.ts';

const read=(f,args={})=>f.b.agentTool('read_inbox',{agent_id:f.recipient.id,...args});
const stateKeys=['id','space_id','grant_id','from_agent','to_agent','title','status','version','scope','channel','created_at','updated_at'];

async function fixture(t) {
  const f=await pair();t.after(()=>f.db.sqlite.close());
  const sibling=await f.b.human('add_agent',{name:'Another owned assistant',provider:'Synthetic'});
  await f.b.human('attach_agent',{space_id:f.space.id,agent_id:sibling.id});
  const siblingGrant=await f.b.human('grant_authority',{space_id:f.space.id,from_agent:f.sender.id,to_agent:sibling.id,allow_assign:true,allow_context:false,expires_at:new Date(Date.now()+86400000).toISOString()});
  const reverse=await f.a.human('grant_authority',{space_id:f.space.id,from_agent:f.recipient.id,to_agent:f.sender.id,allow_assign:true,allow_context:false,expires_at:new Date(Date.now()+86400000).toISOString()});
  const insert=f.db.sqlite.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,version,channel,request_key,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const target=[];
  for(const [prefix,recipient,grant,sender] of [['target',f.recipient.id,f.grant.id,f.sender.id],['sibling',sibling.id,siblingGrant.id,f.sender.id],['other-owner',f.sender.id,reverse.id,f.recipient.id]]) {
    for(let i=0;i<123;i++) {
      const suffix=String(i).padStart(3,'0'),id=prefix+'-'+suffix;
      const status=i<121?['queued','working','needs_input'][i%3]:i===121?'completed':'declined';
      const body=i===0?'😀'.repeat(350)+' complete boundaries '+suffix:'界'.repeat(8000);
      const feedback=i%3?'Latest report '+suffix+' '+'答'.repeat(7900):'';
      const date=new Date(Date.UTC(2026,9,1,0,0,Math.floor(i/4))).toISOString();
      insert.run(id,f.space.id,grant,sender,recipient,'Task '+suffix,body,status,feedback,i,'agent',prefix+'-'+suffix,'h'.repeat(64),date,date);
      if(prefix==='target'&&i<121)target.push({id,status,body,feedback});
    }
  }
  return {...f,target,sibling};
}

async function walk(f,projection,status) {
  const items=[];let cursor;
  do {
    const page=await read(f,{projection,limit:7,...(status?{status}:{}),...(cursor?{cursor}:{})});
    assert.ok(page.instructions.length<=7);
    items.push(...page.instructions);cursor=page.next_cursor;
  }while(cursor);
  return items;
}

test('summary polling reaches all unfinished work and each filter without full text or retry internals',async t=>{
  const f=await fixture(t);
  for(const status of [undefined,'queued','working','needs_input']) {
    const summary=await walk(f,'summary',status),full=await walk(f,'full',status);
    const expected=f.target.filter(task=>!status||task.status===status).map(task=>task.id);
    assert.deepEqual(summary.map(task=>task.id),expected);
    assert.equal(new Set(summary.map(task=>task.id)).size,expected.length);
    assert.deepEqual(summary.map(task=>task.id),full.map(task=>task.id));
    for(let i=0;i<summary.length;i++) {
      const preview=summary[i],complete=full[i];
      for(const key of stateKeys)assert.equal(preview[key],complete[key],key);
      assert.equal(preview.from_name,'Mentor agent');assert.equal(preview.to_name,'Recipient agent');
      assert.deepEqual([...preview.body_preview],[...complete.body].slice(0,300));
      assert.equal(preview.body_characters,[...complete.body].length);
      assert.equal(preview.feedback_available,!!complete.feedback);
      assert.ok([...preview.body_preview].length<=300);
      for(const omitted of ['body','feedback','request_key','request_hash'])assert.equal(Object.hasOwn(preview,omitted),false);
    }
  }
});

test('summary text is bounded in SQL while exact readers retain complete Unicode bodies and reports',async t=>{
  const f=await fixture(t),all=f.b.all.bind(f.b);let projectionQuery,projectionArgs;
  f.b.all=async(sql,...args)=>{if(sql.includes('FROM tasks t JOIN grants')){projectionQuery=sql;projectionArgs=args;}return all(sql,...args);};
  const summary=await read(f,{projection:'summary',limit:1});
  assert.equal(summary.projection,'summary');assert.match(summary.note,/Read the complete/);
  assert.match(projectionQuery,/substr\(t\.body,1,300\) AS body_preview/);
  assert.ok(!projectionQuery.includes('t.*'),'full bodies must not cross the database binding for a preview');
  const plan=f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+projectionQuery).all(...projectionArgs).map(row=>row.detail);
  assert.ok(plan.some(detail=>detail.includes('tasks_actionable_page')));
  assert.ok(!plan.some(detail=>detail.includes('USE TEMP B-TREE FOR ORDER BY')));
  const first=f.target[0],exact=await f.b.agentTool('read_task',{agent_id:f.recipient.id,task_id:first.id});
  assert.equal(exact.task.body,first.body);assert.equal(exact.task.can_report,1);
  assert.ok([...exact.task.body].length>300);
  const reported=f.target[1];
  await f.b.human('report_progress',{task_id:reported.id,expected_version:1,status:'working',feedback:reported.feedback,request_id:'complete-unicode-report'});
  const withReport=await f.b.agentTool('read_task',{agent_id:f.recipient.id,task_id:reported.id});
  assert.equal(withReport.task.body,reported.body);assert.equal(withReport.task.feedback,reported.feedback);
  assert.equal(withReport.updates[0].feedback,reported.feedback);
});

test('full defaults and existing cursor scope remain compatible; projections cannot exchange cursors',async t=>{
  const f=await fixture(t);
  const implicit=await read(f,{limit:1}),explicit=await read(f,{projection:'full',limit:1});
  assert.deepEqual(implicit,explicit);
  const scope=JSON.parse(Buffer.from(implicit.next_cursor,'base64url')).scope;
  assert.equal(scope,JSON.stringify(['inbox',f.b.user.id,f.recipient.id,'']));
  assert.equal((await read(f,{projection:'full',cursor:implicit.next_cursor,limit:1})).instructions[0].id,f.target[1].id);
  const summary=await read(f,{projection:'summary',limit:1});
  await assert.rejects(read(f,{projection:'full',cursor:summary.next_cursor}));
  await assert.rejects(read(f,{cursor:summary.next_cursor}));
  await assert.rejects(read(f,{projection:'summary',cursor:implicit.next_cursor}));
  await assert.rejects(read(f,{projection:'summary',status:'working',cursor:summary.next_cursor}));
  await assert.rejects(f.b.agentTool('read_inbox',{agent_id:f.sibling.id,projection:'summary',cursor:summary.next_cursor}));
  await assert.rejects(read(f,{projection:'short'}));
});

test('summary pages recheck authority after revocation and exclude closed work and other profiles',async t=>{
  const f=await fixture(t),first=await read(f,{projection:'summary',limit:1});
  assert.equal(first.instructions[0].id,'target-000');
  await f.b.human('revoke_authority',{grant_id:f.grant.id});
  const later=await read(f,{projection:'summary',cursor:first.next_cursor});
  assert.deepEqual(later.instructions,[]);assert.equal(later.next_cursor,null);
  const exact=await f.b.agentTool('read_task',{agent_id:f.recipient.id,task_id:'target-000'});
  assert.equal(exact.task.body,f.target[0].body);assert.equal(exact.task.can_report,0,'a retained shared record does not restore authority');
});

for(const mutation of ['profile','recipient membership','sender membership','attachment','ownership'])test(`summary continuation respects changed ${mutation}`,async t=>{
  const f=await fixture(t),first=await read(f,{projection:'summary',limit:1});
  if(mutation==='profile')await f.b.human('disconnect_agent',{agent_id:f.recipient.id});
  if(mutation==='recipient membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.b.user.id);
  if(mutation==='sender membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);
  if(mutation==='attachment')f.db.sqlite.prepare('DELETE FROM space_agents WHERE space_id=? AND agent_id=?').run(f.space.id,f.recipient.id);
  if(mutation==='ownership')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id);
  if(['profile','ownership'].includes(mutation))await assert.rejects(read(f,{projection:'summary',cursor:first.next_cursor}),e=>e.status===403);
  else assert.deepEqual((await read(f,{projection:'summary',cursor:first.next_cursor})).instructions,[]);
});

test('other account calls cannot use a summary profile or continuation',async t=>{
  const f=await fixture(t),first=await read(f,{projection:'summary',limit:1});
  for(const account of [f.a,f.outsider])await assert.rejects(account.agentTool('read_inbox',{agent_id:f.recipient.id,projection:'summary',cursor:first.next_cursor}),e=>e.status===403);
});

for(const projection of ['full','summary'])test(`${projection} inbox binds current ownership in its final query`,async t=>{
  const f=await fixture(t);
  const invitation=await f.a.human('invite_member',{space_id:f.space.id,email:f.outsider.user.email,role:'participant'});
  await f.outsider.human('join_space',{code:invitation.code});
  const all=f.b.all.bind(f.b);let changed=false;
  f.b.all=async(sql,...args)=>{
    if(!changed&&sql.includes('FROM tasks t JOIN grants')) {
      changed=true;
      f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.outsider.user.id,f.recipient.id);
    }
    return all(sql,...args);
  };
  const result=await read(f,{projection});
  assert.equal(changed,true);assert.deepEqual(result.instructions,[]);assert.equal(result.next_cursor,null);
  // Current room membership/attachment keeps the grant otherwise eligible; only ownership changed.
  assert.ok((await f.outsider.agentTool('read_inbox',{agent_id:f.recipient.id,projection})).instructions.length>0);
});

test('MCP discovers optional projection and rejects invalid values before private identity is resolved',async t=>{
  const f=await fixture(t),definition=agentTools.find(tool=>tool.name==='read_inbox');
  assert.deepEqual(definition.inputSchema.properties.projection.enum,['summary','full']);
  assert.ok(!definition.inputSchema.required.includes('projection'));
  assert.match(agentInstructions,/poll read_inbox with projection summary/);assert.match(agentInstructions,/Before acting or reporting, call read_task/);
  const call=(projection,resolve)=>handleMcpPost(new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_inbox',arguments:{agent_id:f.recipient.id,projection,limit:1}}})}),resolve);
  const response=await(await call('summary',async()=>f.b)).json();
  assert.deepEqual(JSON.parse(response.result.content[0].text),response.result.structuredContent);
  assert.equal(response.result.structuredContent.projection,'summary');
  const invalid=await(await call('short',async()=>{assert.fail('invalid schemas must not resolve private identity');})).json();
  assert.equal(invalid.result.isError,true);
});
