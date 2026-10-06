import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {Granola} from '../lib/granola.ts';
import {GRANOLA_ISSUER,GRANOLA_MCP,GranolaRequestBudget} from '../lib/granola-mcp.ts';
import {handleGranolaRequest} from '../lib/granola-http.ts';
import {clientRequest} from '../lib/client-request.ts';
import {nonce} from '../lib/provider-crypto.ts';

const tools=[{name:'query_granola_meetings',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function provider(before=async()=>{}){
  const calls=[];
  const fetcher=async(url,init={})=>{
    const rpc=url===GRANOLA_MCP?JSON.parse(init.body):null;
    const phase=rpc?.method||url.split('/').at(-1),call={phase,url,init,rpc};calls.push(call);
    const override=await before(call);if(override)return override;
    if(phase==='mcp'&&!rpc)return Response.json({resource:GRANOLA_MCP,authorization_servers:[GRANOLA_ISSUER]});
    if(phase==='oauth-authorization-server')return Response.json({issuer:GRANOLA_ISSUER,authorization_endpoint:GRANOLA_ISSUER+'/oauth2/authorize',token_endpoint:GRANOLA_ISSUER+'/oauth2/token',registration_endpoint:GRANOLA_ISSUER+'/oauth2/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
    if(phase==='register')return Response.json({client_id:'synthetic_client',token_endpoint_auth_method:'none'});
    if(phase==='token')return Response.json({access_token:'synthetic_rotated_access',refresh_token:'synthetic_rotated_refresh',token_type:'Bearer',expires_in:3600});
    if(phase==='notifications/initialized')return new Response(null,{status:202});
    const result=phase==='initialize'?{protocolVersion:'2025-06-18'}:phase==='tools/list'?{tools}:{content:[{type:'text',text:'Synthetic notes'}]};
    assert.ok(rpc);return Response.json({jsonrpc:'2.0',id:rpc.id,result});
  };
  return{fetcher,calls};
}
async function setup(t,before,credential={}){
  const f=await pair();t.after(()=>f.db.sqlite.close());const p=provider(before),g=new Granola(f.b,nonce(),p.fetcher);
  const connection_id='synthetic_connection',value={client_id:'synthetic_client',access_token:'synthetic_access',expires_at:Date.now()+3600000,...credential};
  const sealed=await g.vault.seal(value,'credential:'+connection_id);
  f.db.sqlite.prepare("INSERT INTO provider_connections (owner_id,provider,connection_id,credential,account_label,status,version,updated_at) VALUES (?,'granola',?,?,'Synthetic account','connected',0,?)").run(f.b.user.id,connection_id,sealed,new Date().toISOString());
  return{...f,...p,g,row:()=>f.db.sqlite.prepare("SELECT * FROM provider_connections WHERE owner_id=? AND provider='granola'").get(f.b.user.id)};
}
function needsSignIn(f){const row=f.row();assert.equal(row.status,'reauth_required');assert.equal(row.credential,null);assert.equal(row.account_label,null);assert.equal(row.refresh_key,null);assert.equal(row.version,1);}

test('an expired credential without refresh access requires sign-in once and makes no provider request',async t=>{
  const f=await setup(t,undefined,{expires_at:Date.now()-1});
  await assert.rejects(f.g.tools(),{status:401});needsSignIn(f);assert.equal(f.calls.length,0);
  await assert.rejects(f.g.tools(),{status:409});assert.equal(f.calls.length,0);assert.equal(f.row().version,1);
});

for(const phase of ['initialize','tools/list','tools/call'])test(`${phase} authentication rejection clears only the failed connection and does not retry it`,async t=>{
  const f=await setup(t,async call=>call.phase===phase?new Response(null,{status:401}):undefined);
  const read=phase==='tools/call'?()=>f.g.preview({tool:tools[0].name,parameters:{query:'Synthetic'}}):()=>f.g.tools();
  await assert.rejects(read(),{status:401});needsSignIn(f);
  const count=f.calls.length;await assert.rejects(read(),{status:409});assert.equal(f.calls.length,count);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM provider_import_drafts').get().n,0);
});

for(const change of ['new sign-in','new credential','refresh in progress'])test(`a delayed authentication rejection preserves a ${change}`,async t=>{
  const entered=deferred(),release=deferred(),f=await setup(t,async call=>{if(call.phase==='initialize'){entered.resolve();await release.promise;return new Response(null,{status:401});}});
  const read=f.g.tools(),rejected=assert.rejects(read,{status:409});await entered.promise;
  if(change==='new sign-in')f.db.sqlite.prepare("UPDATE provider_connections SET connection_id='new_synthetic_connection',credential='new_synthetic_ciphertext',account_label='New account',version=version+1").run();
  if(change==='new credential')f.db.sqlite.prepare("UPDATE provider_connections SET credential='new_synthetic_ciphertext',version=version+1").run();
  if(change==='refresh in progress')f.db.sqlite.prepare("UPDATE provider_connections SET refresh_key='new_synthetic_lease',refresh_until=?").run(new Date(Date.now()+60000).toISOString());
  const newer={...f.row()};release.resolve();await rejected;assert.deepEqual({...f.row()},newer);
});

test('concurrent rejected reads invalidate a credential once',async t=>{
  const entered=deferred(),release=deferred();let waiting=0;
  const f=await setup(t,async call=>{if(call.phase==='initialize'){if(++waiting===2)entered.resolve();await release.promise;return new Response(null,{status:401});}});
  const results=Promise.allSettled([f.g.tools(),f.g.tools()]);await entered.promise;release.resolve();
  assert.deepEqual((await results).map(r=>r.reason.status).sort(),[401,409]);needsSignIn(f);
});

test('a transient provider failure retains authorization and permits a later read',async t=>{
  let failed=false;const f=await setup(t,async call=>{if(call.phase==='initialize'&&!failed){failed=true;return new Response(null,{status:503});}}),before={...f.row()};
  await assert.rejects(f.g.tools(),{status:502});assert.deepEqual({...f.row()},before);
  assert.equal((await f.g.tools()).tools.length,1);assert.deepEqual({...f.row()},before);
});

for(const [action,delay] of [['connect',8000],['tools',8000],['preview',6000]])test(`${action} ends before the actual client deadline and cannot create a late sign-in or preview`,async t=>{
  const started=Date.now();t.mock.timers.enable({apis:['setTimeout','Date'],now:started});
  const entered=Array.from({length:4},deferred);let count=0;
  // This adapter intentionally ignores abort and supplies its final response late.
  const f=await setup(t,async()=>{entered[count++].resolve();await new Promise(resolve=>setTimeout(resolve,delay));});
  let server;
  t.mock.method(globalThis,'fetch',(_path,init)=>{
    const incoming=new Request('https://accord.example.test/api/integrations/granola',{...init,headers:{...init.headers,Origin:'https://accord.example.test'}});
    server=handleGranolaRequest(incoming,async()=>f.g,new GranolaRequestBudget(18000,Date.now));
    const abort=new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    return Promise.race([server,abort]);
  });
  const pending=clientRequest('/api/integrations/granola',action,action==='preview'?{tool:tools[0].name,parameters:{query:'Synthetic'}}:{}),rejected=assert.rejects(pending,error=>error.status===502&&!/timed out/i.test(error.message));
  await entered[0].promise;t.mock.timers.tick(delay);await entered[1].promise;t.mock.timers.tick(delay);await entered[2].promise;
  t.mock.timers.tick(18000-2*delay);await rejected;assert.equal((await server).status,502);assert.equal(Date.now()-started,18000);assert.equal(count,3);
  t.mock.timers.tick(24000-18000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,3,'expiry must not begin another provider request');
  assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM provider_oauth_flows WHERE status='pending'").get().n,0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM provider_import_drafts').get().n,0);
  assert.equal(f.row().status,'connected','a deadline alone must not erase authorization');
  t.diagnostic(`${action}: returned 502 at 18,000ms before the 20,000ms client deadline; ignored-abort work could not commit at 24,000ms.`);
});

test('received rotating refresh credentials persist even when local sealing consumes the remaining budget',async t=>{
  const f=await setup(t,undefined,{expires_at:Date.now()-1,refresh_token:'synthetic_original_refresh'});let clock=0;
  const seal=f.g.vault.seal.bind(f.g.vault);t.mock.method(f.g.vault,'seal',async(...args)=>{const result=await seal(...args);clock=18000;return result;});
  await assert.rejects(f.g.tools(new GranolaRequestBudget(18000,()=>clock)),{status:502});
  const row=f.row();assert.equal(row.status,'connected');assert.equal(row.refresh_key,null);assert.equal(row.version,1);
  const stored=await f.g.vault.open(row.credential,'credential:'+row.connection_id);assert.equal(stored.refresh_token,'synthetic_rotated_refresh');assert.equal(stored.access_token,'synthetic_rotated_access');
  assert.equal(f.calls.filter(call=>call.phase==='token').length,1);assert.equal(f.calls.filter(call=>call.rpc).length,0);
  assert.equal((await f.g.tools()).tools.length,1);assert.equal(f.calls.filter(call=>call.phase==='token').length,1,'the original rotating token must not be replayed');
});

for(const expiry of ['before reading','during lease acquisition'])test(`budget expiry ${expiry} preserves an unused refresh credential`,async t=>{
  const f=await setup(t,undefined,{expires_at:Date.now()-1,refresh_token:'synthetic_original_refresh'}),before={...f.row()};let clock=0;
  const budget=new GranolaRequestBudget(18000,()=>clock);
  if(expiry==='before reading')clock=18000;
  else{
    const stmt=f.b.stmt.bind(f.b);
    t.mock.method(f.b,'stmt',(sql,...args)=>{const statement=stmt(sql,...args);if(sql.startsWith('UPDATE provider_connections SET refresh_key=?')){const run=statement.run.bind(statement);statement.run=async()=>{const result=await run();clock=18000;return result;};}return statement;});
  }
  await assert.rejects(f.g.tools(budget),{status:502});assert.equal(f.calls.length,0);assert.deepEqual({...f.row()},before);
  assert.equal((await f.g.tools()).tools.length,1);assert.equal(f.calls.filter(call=>call.phase==='token').length,1);
});

test('a bounded callback fails its one-use flow and cannot persist a late connection',async t=>{
  const started=Date.now();t.mock.timers.enable({apis:['setTimeout','Date'],now:started});
  let delayed=false,index=0;const entered=Array.from({length:4},deferred);
  const f=await setup(t,async()=>{if(delayed){entered[index++].resolve();await new Promise(resolve=>setTimeout(resolve,6000));}});
  const start=await f.g.start('https://accord.example.test'),state=new URL(start.authorization_url).searchParams.get('state'),before={...f.row()};delayed=true;
  const rejected=assert.rejects(f.g.complete(state,'synthetic_code',false,new GranolaRequestBudget(18000,Date.now)),{status:502});
  await entered[0].promise;t.mock.timers.tick(6000);await entered[1].promise;t.mock.timers.tick(6000);await entered[2].promise;t.mock.timers.tick(6000);await rejected;
  t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(index,3);assert.deepEqual({...f.row()},before);
  const flow=f.db.sqlite.prepare('SELECT status,details FROM provider_oauth_flows').get();assert.equal(flow.status,'failed');assert.equal(flow.details,null);
  await assert.rejects(f.g.complete(state,'synthetic_code'),{status:409});assert.equal(index,3);
});

for(const action of ['connect','preview'])test(`budget expiry during ${action} sealing prevents a new private record`,async t=>{
  const f=await setup(t);let clock=0;const seal=f.g.vault.seal.bind(f.g.vault);
  t.mock.method(f.g.vault,'seal',async(...args)=>{const result=await seal(...args);clock=18000;return result;});
  const budget=new GranolaRequestBudget(18000,()=>clock);
  await assert.rejects(action==='connect'?f.g.start('https://accord.example.test',budget):f.g.preview({tool:tools[0].name,parameters:{query:'Synthetic'}},budget),{status:502});
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM provider_oauth_flows').get().n,0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM provider_import_drafts').get().n,0);assert.equal(f.row().status,'connected');
});
