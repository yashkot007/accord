import {test} from 'node:test';
import assert from 'node:assert/strict';
import {McpAdmission,isHeavyMcpRead} from '../lib/mcp-admission.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {AppError} from '../lib/workspace.ts';
import {pair} from './helpers/workspace.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const call=(name,args={},id=0)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const request=(message,signal)=>new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message),signal});
const zero={bodies:0,tools:0,heavyReads:0,accounts:0};
function workspace(account,execute=async()=>({ok:true})){return{user:{id:account},agentTool:execute};}
async function overload(response,id){
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'1');assert.equal(response.headers.get('Cache-Control'),'no-store');
  const body=await response.json();assert.equal(body.error.code,-32000);
  if(id===undefined)assert.equal(Object.hasOwn(body,'id'),false);else assert.equal(body.id,id);
  assert.match(body.error.message,/same arguments and request reference/);
}

test('body admission rejects excess streams before parsing or authentication and recovers after timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const admission=new McpAdmission({bodies:1,bodyTimeoutMs:5000}),entered=deferred();
  let calls=0,cancelled=false;
  const source=new ReadableStream({pull(){entered.resolve();},cancel(){return new Promise(()=>{});}},{highWaterMark:0});
  const pending=handleMcpPost(new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:source,duplex:'half'}),async()=>{calls++;return workspace('one');},admission);
  await entered.promise;
  const excess=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
  await overload(await handleMcpPost(new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:excess,duplex:'half'}),async()=>{calls++;return workspace('two');},admission));
  assert.equal(cancelled,true);assert.equal(calls,0);assert.equal(admission.usage.bodies,1);
  t.mock.timers.tick(5000);assert.equal((await pending).status,408);assert.deepEqual(admission.usage,zero);
  const recovered=await handleMcpPost(request({jsonrpc:'2.0',id:'recovered',method:'ping'}),async()=>{calls++;return workspace('one');},admission);
  assert.equal(recovered.status,200);assert.equal(calls,0);assert.deepEqual(admission.usage,zero);
});

test('global execution admission bounds unresolved authentication and leaves discovery responsive',async()=>{
  const admission=new McpAdmission({tools:1}),entered=deferred(),release=deferred();let resolved=0;
  const pending=handleMcpPost(request(call('list_my_agents')),async()=>{resolved++;entered.resolve();await release.promise;return workspace('one');},admission);
  await entered.promise;
  await overload(await handleMcpPost(request(call('list_my_agents',{},'busy')),async()=>{resolved++;return workspace('two');},admission),'busy');
  assert.equal(resolved,1);
  for(const message of [{jsonrpc:'2.0',id:0,method:'ping'},{jsonrpc:'2.0',id:'list',method:'tools/list'},{jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}]){
    assert.equal((await handleMcpPost(request(message),async()=>{throw Error('Discovery must not authenticate');},admission)).status,200);
  }
  assert.equal((await handleMcpPost(request({jsonrpc:'2.0',method:'notifications/initialized'}),async()=>{throw Error('Notification must not authenticate');},admission)).status,202);
  assert.deepEqual(admission.usage,{bodies:0,tools:1,heavyReads:0,accounts:0});
  release.resolve();assert.equal((await pending).status,200);assert.deepEqual(admission.usage,zero);
});

test('account fairness uses fresh authenticated account identity across different profiles',async()=>{
  const admission=new McpAdmission({tools:3,perAccount:1}),entered=deferred(),release=deferred();let auth=0,executions=0;
  const pending=handleMcpPost(request(call('connect_agent',{agent_id:'first-profile'})),async()=>{auth++;return workspace('same-account',async()=>{executions++;entered.resolve();await release.promise;return{ok:true};});},admission);
  await entered.promise;
  await overload(await handleMcpPost(request(call('connect_agent',{agent_id:'different-profile'},0)),async()=>{auth++;return workspace('same-account',async()=>{executions++;return{};});},admission),0);
  assert.equal(auth,2);assert.equal(executions,1);
  const other=await handleMcpPost(request(call('connect_agent',{agent_id:'first-profile'})),async()=>{auth++;return workspace('different-account',async()=>{executions++;return{};});},admission);
  assert.equal(other.status,200);assert.equal(auth,3);assert.equal(executions,2);assert.equal(admission.usage.accounts,1);
  release.resolve();await pending;assert.deepEqual(admission.usage,zero);
});

test('large full readers have a shared budget while summary polling can continue',async()=>{
  const admission=new McpAdmission({tools:4,perAccount:3,heavyReads:1}),entered=deferred(),release=deferred();let auth=0;
  const pending=handleMcpPost(request(call('read_inbox',{agent_id:'one',projection:'full'})),async()=>{auth++;return workspace('one',async()=>{entered.resolve();await release.promise;return{instructions:[]};});},admission);
  await entered.promise;
  await overload(await handleMcpPost(request(call('read_context',{agent_id:'two'},'context')),async()=>{auth++;return workspace('two');},admission),'context');
  assert.equal(auth,1);
  assert.equal((await handleMcpPost(request(call('read_inbox',{agent_id:'two',projection:'summary'})),async()=>{auth++;return workspace('two');},admission)).status,200);
  assert.equal(auth,2);assert.equal(admission.usage.heavyReads,1);
  release.resolve();await pending;assert.deepEqual(admission.usage,zero);
  for(const name of ['read_context','read_task','read_context_change','list_spaces','list_sessions'])assert.equal(isHeavyMcpRead(name,{}),true);
  assert.equal(isHeavyMcpRead('read_inbox',{}),true);assert.equal(isHeavyMcpRead('read_inbox',{projection:'summary'}),false);
});

test('every settlement path releases capacity including failures while building the response',async()=>{
  const admission=new McpAdmission({tools:1,perAccount:1,heavyReads:1});
  const cycle={};cycle.self=cycle;
  const resolvers=[
    async()=>{throw new AppError('Sign in.',401);},
    async()=>workspace('one',async()=>{throw new AppError('Access changed.',403);}),
    async()=>workspace('one',async()=>{throw Error('Unexpected failure');}),
    async()=>workspace('one',async()=>cycle),
    async()=>workspace('one',async()=>({ok:true})),
  ];
  const statuses=[401,200,503,503,200];
  for(let i=0;i<resolvers.length;i++){
    assert.equal((await handleMcpPost(request(call('read_context',{agent_id:'a'})),resolvers[i],admission)).status,statuses[i]);
    assert.deepEqual(admission.usage,zero);
  }
});

test('a disconnect cannot free a dispatched tool slot while its work remains unresolved',async()=>{
  const admission=new McpAdmission({tools:1}),entered=deferred(),release=deferred(),controller=new AbortController();let executed=0;
  const pending=handleMcpPost(request(call('connect_agent',{agent_id:'one'}),controller.signal),async()=>workspace('one',async()=>{executed++;entered.resolve();await release.promise;return{done:true};}),admission);
  await entered.promise;controller.abort();
  assert.equal(admission.usage.tools,1);
  await overload(await handleMcpPost(request(call('list_my_agents')),async()=>workspace('two'),admission),0);
  assert.equal(executed,1);release.resolve();assert.equal((await pending).status,200);assert.deepEqual(admission.usage,zero);
});

test('abort before dispatch never invokes a tool and restores both body and auth capacity',async()=>{
  const admission=new McpAdmission({tools:1}),before=new AbortController();before.abort();let auth=0,executed=0;
  const resolver=async()=>{auth++;return workspace('one',async()=>{executed++;return{};});};
  assert.equal((await handleMcpPost(request(call('list_my_agents'),before.signal),resolver,admission)).status,400);assert.equal(auth,0);
  const during=new AbortController(),entered=deferred(),release=deferred();
  const pending=handleMcpPost(request(call('list_my_agents'),during.signal),async()=>{auth++;entered.resolve();await release.promise;return workspace('one',async()=>{executed++;return{};});},admission);
  await entered.promise;during.abort();assert.equal(admission.usage.tools,1);release.resolve();assert.equal((await pending).status,400);
  assert.equal(auth,1);assert.equal(executed,0);assert.deepEqual(admission.usage,zero);
});

test('rejected durable writes leave the database unchanged and retry with one receipt',async()=>{
  const f=await pair(),admission=new McpAdmission({tools:2,perAccount:1}),entered=deferred(),release=deferred();
  const snapshot=()=>Object.fromEntries(['agents','tasks','events','changes'].map(table=>[table,f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const pending=handleMcpPost(request(call('list_my_agents')),async()=>workspace(f.a.user.id,async()=>{entered.resolve();await release.promise;return{};}),admission);
  try{
    await entered.promise;const original=snapshot();let sql=0;
    const prepare=f.db.prepare;f.db.prepare=(...args)=>{sql++;return prepare(...args);};
    const args={agent_id:f.sender.id,grant_id:f.grant.id,title:'Retry once',body:'Trace the side-effect boundary.',request_id:'admission-retry'};
    await overload(await handleMcpPost(request(call('send_instruction',args,'retry')),async()=>f.a,admission),'retry');
    assert.equal(sql,0);assert.deepEqual(snapshot(),original);
    release.resolve();await pending;
    const first=await(await handleMcpPost(request(call('send_instruction',args)),async()=>f.a,admission)).json();
    const saved=snapshot(),again=await(await handleMcpPost(request(call('send_instruction',args)),async()=>f.a,admission)).json();
    assert.deepEqual(again.result.structuredContent,first.result.structuredContent);assert.deepEqual(snapshot(),saved);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM tasks').get().n,1);
    assert.deepEqual(admission.usage,zero);
  }finally{release.resolve();await pending;f.db.sqlite.close();}
});

test('leases release once and account state disappears when inactive; instances are isolate-local',()=>{
  const admission=new McpAdmission({bodies:1,tools:1,perAccount:1,heavyReads:1});
  for(let i=0;i<2000;i++){
    const body=admission.claimBody(),tool=admission.claimTool(true),account=admission.claimAccount('account-'+i);
    assert.ok(body&&tool&&account);assert.equal(admission.claimBody(),null);assert.equal(admission.claimTool(false),null);assert.equal(admission.claimAccount('account-'+i),null);
    account();account();tool();tool();body();body();assert.deepEqual(admission.usage,zero);
  }
  const other=new McpAdmission({tools:1}),release=admission.claimTool(false),independent=other.claimTool(false);
  assert.ok(release&&independent);release();independent();assert.deepEqual(admission.usage,zero);assert.deepEqual(other.usage,zero);
});
