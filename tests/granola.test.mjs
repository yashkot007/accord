import test from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {Granola} from '../lib/granola.ts';
import {GranolaMcp,GRANOLA_MCP,GRANOLA_ISSUER,providerFetch} from '../lib/granola-mcp.ts';
import {ProviderVault,nonce,digest} from '../lib/provider-crypto.ts';
import {handleGranolaRequest} from '../lib/granola-http.ts';
import {AppError} from '../lib/workspace.ts';

const tools=[
  {name:'get_account_info',inputSchema:{type:'object',properties:{}}},
  {name:'query_granola_meetings',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1}},required:['query']}},
  {name:'delete_meeting',inputSchema:{type:'object',properties:{}}}
];
function provider({beforeToken,beforeQuery,beforeRegister,tokenDuration=3600,sse=false}={}){
  const calls=[];
  const fetcher=async(url,init={})=>{
    calls.push({url,init});
    if(url.endsWith('/oauth-protected-resource/mcp'))return Response.json({resource:GRANOLA_MCP,authorization_servers:[GRANOLA_ISSUER]});
    if(url.endsWith('/oauth-authorization-server'))return Response.json({issuer:GRANOLA_ISSUER,authorization_endpoint:GRANOLA_ISSUER+'/oauth2/authorize',token_endpoint:GRANOLA_ISSUER+'/oauth2/token',registration_endpoint:GRANOLA_ISSUER+'/oauth2/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
    if(url.endsWith('/oauth2/register')){await beforeRegister?.();return Response.json({client_id:'synthetic_client',token_endpoint_auth_method:'none'});}
    if(url.endsWith('/oauth2/token')){await beforeToken?.(new URLSearchParams(init.body).get('grant_type'));return Response.json({access_token:'synthetic_access',refresh_token:'synthetic_refresh',token_type:'Bearer',expires_in:tokenDuration});}
    assert.equal(url,GRANOLA_MCP);assert.equal(init.headers.Authorization,'Bearer synthetic_access');
    const request=JSON.parse(init.body);
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    let result;
    if(request.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'Synthetic provider',version:'1'}};
    else if(request.method==='tools/list')result={tools};
    else if(request.method==='tools/call'){
      assert.notEqual(request.params.name,'delete_meeting');
      if(request.params.name==='get_account_info')result={content:[{type:'text',text:'Synthetic Granola account · Synthetic workspace'}]};
      else{await beforeQuery?.();result={content:[{type:'text',text:'Synthetic coaching note: clarify requirements. Private detail not selected.'}]};}
    }else assert.fail(request.method);
    const envelope={jsonrpc:'2.0',id:request.id,result};
    return sse?new Response('event: message\r\ndata: '+JSON.stringify(envelope)+'\r\n\r\n',{headers:{'content-type':'text/event-stream','Mcp-Session-Id':'synthetic_session'}}):Response.json(envelope,{headers:{'Mcp-Session-Id':'synthetic_session'}});
  };
  return {fetcher,calls};
}
async function setup(options={}){
  const f=await pair(),secret=nonce(),p=provider(options);
  const g=new Granola(f.b,secret,p.fetcher),other=new Granola(f.outsider,secret,p.fetcher);
  const start=await g.start('https://accord.example.test'),state=new URL(start.authorization_url).searchParams.get('state');
  return {...f,...p,g,other,secret,state,start};
}
async function connected(options={}){const f=await setup(options);await f.g.complete(f.state,'synthetic_code');return f;}

test('provider redirects are rejected without following or forwarding credentials',async()=>{
  let count=0;
  const fetcher=async(url,init)=>{count++;assert.equal(url,GRANOLA_MCP);assert.equal(init.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://untrusted.example.test/'}});};
  await assert.rejects(providerFetch(fetcher,GRANOLA_MCP,{headers:{Authorization:'Bearer synthetic_access'}}),/could not complete/);
  assert.equal(count,1);
});

test('MCP event streams accept CRLF frames split across network chunks',async()=>{
  const fetcher=async(_url,init)=>{
    const request=JSON.parse(init.body);
    const frame='event: message\r\ndata: '+JSON.stringify({jsonrpc:'2.0',id:request.id,result:{tools}})+'\r\n\r\n';
    const chunks=frame.split(/(?<=\r)/).map(part=>new TextEncoder().encode(part));
    return new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
  };
  assert.equal((await new GranolaMcp('synthetic_access',fetcher).rpc('tools/list')).tools[1].name,'query_granola_meetings');
});

test('owner-bound vault rejects another person, another purpose and tampering; unavailable key fails closed',async()=>{
  const secret=nonce(),vault=new ProviderVault(secret,'owner');
  const ciphertext=await vault.seal({credential:'synthetic_access'},'credential:test');assert.ok(!ciphertext.includes('synthetic_access'));
  assert.deepEqual(await vault.open(ciphertext,'credential:test'),{credential:'synthetic_access'});
  await assert.rejects(new ProviderVault(secret,'other').open(ciphertext,'credential:test'));
  await assert.rejects(vault.open(ciphertext,'draft:test'));
  await assert.rejects(vault.open(ciphertext+'x','credential:test'));
  await assert.rejects(new ProviderVault(undefined,'owner').seal({},'test'));
});
test('OAuth binds PKCE, exact resource and callback, encrypts state, verifies provider tools before storing a connection',async()=>{
  const f=await setup(),url=new URL(f.start.authorization_url);
  assert.equal(url.origin,GRANOLA_ISSUER);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('resource'),GRANOLA_MCP);assert.equal(url.searchParams.get('redirect_uri'),'https://accord.example.test/api/integrations/granola/callback');
  const flow=f.db.sqlite.prepare('SELECT * FROM provider_oauth_flows').get();assert.equal(flow.state_hash,await digest(f.state));assert.ok(!flow.details.includes(f.state));
  const details=await f.g.vault.open(flow.details,'oauth:'+flow.state_hash);assert.equal(url.searchParams.get('code_challenge'),await digest(details.verifier));
  await assert.rejects(f.other.complete(f.state,'synthetic_code'),/account/);
  assert.equal((await f.g.complete(f.state,'synthetic_code')).status,'connected');
  const row=f.db.sqlite.prepare('SELECT * FROM provider_connections').get();assert.ok(!row.credential.includes('synthetic_access'));
  assert.equal(f.db.sqlite.prepare('SELECT details FROM provider_oauth_flows').get().details,null);
  assert.ok(!JSON.stringify(await f.g.status()).includes('synthetic_access'));
  assert.equal((await f.other.status()).status,'not_connected');
  await assert.rejects(f.g.complete(f.state,'synthetic_code'),/no longer/);
});
test('expired, denied and superseded OAuth cannot connect',async()=>{
  const f=await setup();f.db.sqlite.prepare("UPDATE provider_oauth_flows SET expires_at='2000-01-01'").run();await assert.rejects(f.g.complete(f.state,'code'),/no longer/);
  const second=await f.g.start('https://accord.example.test');const state=new URL(second.authorization_url).searchParams.get('state');
  await assert.rejects(f.g.complete(state,'',true),/cancelled/);assert.equal((await f.g.status()).status,'not_connected');
  const third=await f.g.start('https://accord.example.test');await f.g.start('https://accord.example.test');await assert.rejects(f.g.complete(new URL(third.authorization_url).searchParams.get('state'),'code'),/no longer/);
});
test('disconnect during OAuth exchange cannot restore access',async()=>{
  let f;f=await setup({beforeToken:async()=>f.g.disconnect()});await assert.rejects(f.g.complete(f.state,'code'),/changed/);assert.equal((await f.g.status()).status,'disconnected');
});
test('a private preview does not share data; edited import has one attributable source, stable retry and conflict detection',async()=>{
  const f=await connected({sse:true}),count=f.db.sqlite.prepare('SELECT count(*) AS n FROM sources').get().n;
  assert.deepEqual((await f.g.tools()).tools.map(t=>t.name),['query_granola_meetings']);
  const preview=await f.g.preview({tool:'query_granola_meetings',parameters:{query:'Find coaching notes'}});
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM sources').get().n,count);
  assert.ok(!f.db.sqlite.prepare('SELECT content FROM provider_import_drafts').get().content.includes('Private detail'));
  const args={draft_id:preview.draft_id,space_id:f.space.id,title:'Selected lesson',content:'Clarify requirements.'};
  await assert.rejects(f.other.share(args),/not available/);
  const saved=await f.g.share(args),retry=await f.g.share(args);assert.equal(retry.id,saved.id);assert.equal(retry.replayed,true);
  const source=f.db.sqlite.prepare('SELECT * FROM sources WHERE id=?').get(saved.id);assert.equal(source.created_by,f.b.user.id);assert.match(source.content,/Selected Granola excerpt/);assert.ok(!source.content.includes('Private detail'));
  assert.equal(f.db.sqlite.prepare('SELECT content FROM provider_import_drafts').get().content,'');
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM sources').get().n,count+1);
  await assert.rejects(f.g.share({...args,content:'Different content'}),/different content/);
  await f.g.disconnect();assert.equal((await f.g.share(args)).id,saved.id);assert.ok((await f.b.readSpace(f.space.id)).sources.some(s=>s.id===saved.id));
});
test('unavailable space, expired preview and disconnected connection cannot share an uncommitted excerpt',async()=>{
  const f=await connected(),preview=await f.g.preview({tool:'query_granola_meetings',parameters:{query:'Notes'}});
  const args={draft_id:preview.draft_id,space_id:f.space.id,title:'Selected',content:'Selected'};
  await assert.rejects(f.g.share({...args,space_id:'missing'}),/not available/);
  f.db.sqlite.prepare("UPDATE provider_import_drafts SET expires_at='2000-01-01' WHERE id=?").run(preview.draft_id);await assert.rejects(f.g.share(args),/expired/);
  const second=await f.g.preview({tool:'query_granola_meetings',parameters:{query:'Notes'}});await f.g.disconnect();await assert.rejects(f.g.share({...args,draft_id:second.draft_id}),/no longer/);
  await assert.rejects(f.g.tools(),/Connect Granola/);assert.equal(f.db.sqlite.prepare('SELECT credential FROM provider_connections').get().credential,null);
});
test('disconnect during a read discards its response without storing a preview',async()=>{
  let f;f=await connected({beforeQuery:async()=>f.g.disconnect()});await assert.rejects(f.g.preview({tool:'query_granola_meetings',parameters:{query:'Notes'}}),/changed/);assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM provider_import_drafts').get().n,0);
});
test('provider schema is discovered and write, unknown, missing and invalid fields are rejected',async()=>{
  const f=await connected();await assert.rejects(f.g.preview({tool:'delete_meeting',parameters:{}}),/supported/);
  await assert.rejects(f.g.preview({tool:'query_granola_meetings',parameters:{}}),/Enter query/);
  await assert.rejects(f.g.preview({tool:'query_granola_meetings',parameters:{query:3}}),/valid query/);
  await assert.rejects(f.g.preview({tool:'query_granola_meetings',parameters:{query:'Notes',unknown:'unsafe'}}),/unsupported/);
});
test('refresh is server-owned and cannot restore a disconnected connection',async()=>{
  const f=await connected({tokenDuration:1});const listed=await f.g.tools();assert.equal(listed.tools.length,1);
  const tokenCalls=f.calls.filter(c=>c.url.endsWith('/oauth2/token'));assert.equal(tokenCalls.length,2);assert.match(tokenCalls[1].init.body.toString(),/grant_type=refresh_token/);
  await f.g.disconnect();await assert.rejects(f.g.tools(),/Connect Granola/);assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth2/token')).length,2);
});
test('malformed provider replies, oversized bodies, untrusted redirects and changed metadata fail closed',async()=>{
  const mcp=new GranolaMcp('synthetic',async()=>Response.json({jsonrpc:'2.0',id:'wrong',result:{}}));await assert.rejects(mcp.initialize(),/could not complete/);
  const huge=new GranolaMcp('synthetic',async()=>new Response('x'.repeat(300000)));await assert.rejects(huge.initialize(),/too much/);
  const f=await pair(),g=new Granola(f.b,nonce(),async()=>Response.json({resource:'https://untrusted.example/mcp',authorization_servers:[GRANOLA_ISSUER]}));await assert.rejects(g.start('https://accord.example.test'),/changed/);
});
test('disconnect during client registration prevents a late pending OAuth flow',async()=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const f=await pair(),p=provider({beforeRegister:async()=>{entered();await gate;}}),g=new Granola(f.b,nonce(),p.fetcher);
  const pending=g.start('https://accord.example.test');await ready;await g.disconnect();release();
  await assert.rejects(pending,/changed/);assert.equal((await g.status()).status,'disconnected');assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM provider_oauth_flows WHERE status='pending'").get().n,0);
});
test('concurrent expired-token reads acquire one refresh lease before provider calls',async()=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const f=await connected({tokenDuration:1,beforeToken:async grant=>{if(grant==='refresh_token'){entered();await gate;}}});
  const first=f.g.tools();await ready;await assert.rejects(f.g.tools(),/being refreshed/);release();await first;
  const refreshes=f.calls.filter(c=>c.url.endsWith('/oauth2/token')&&String(c.init.body).includes('grant_type=refresh_token'));assert.equal(refreshes.length,1);assert.equal(f.db.sqlite.prepare('SELECT refresh_key FROM provider_connections').get().refresh_key,null);
});
test('an abandoned expired refresh lease requires new authorization without another provider request',async()=>{
  const f=await connected({tokenDuration:1}),count=f.calls.length;
  f.db.sqlite.prepare("UPDATE provider_connections SET refresh_key='synthetic_abandoned_lease',refresh_until='2000-01-01'").run();
  await assert.rejects(f.g.tools(),/sign in again/);
  assert.equal(f.calls.length,count);assert.equal((await f.g.status()).status,'reauth_required');
  assert.equal(f.db.sqlite.prepare('SELECT credential FROM provider_connections').get().credential,null);
  await assert.rejects(f.g.tools(),/Connect Granola/);assert.equal(f.calls.length,count);
});
test('lost refresh results require new authorization instead of another rotating-token attempt',async()=>{
  const f=await connected({tokenDuration:1,beforeToken:async grant=>{if(grant==='refresh_token')throw Error('Synthetic lost response');}});
  await assert.rejects(f.g.tools(),/could not be reached/);assert.equal((await f.g.status()).status,'reauth_required');assert.equal(f.db.sqlite.prepare('SELECT credential FROM provider_connections').get().credential,null);
  await assert.rejects(f.g.tools(),/Connect Granola/);assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth2/token')).length,2);
});
test('HTTP connection actions require same-origin authenticated requests before any provider work',async()=>{
  let calls=0;const loader=async()=>{calls++;throw new AppError('Sign in.',401);};
  const request=(origin,extra={})=>new Request('https://accord.example.test/api/integrations/granola',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...extra},body:JSON.stringify({action:'connect',args:{}})});
  assert.equal((await handleGranolaRequest(request(undefined),loader)).status,403);
  assert.equal((await handleGranolaRequest(request('https://foreign.example'),loader)).status,403);
  assert.equal((await handleGranolaRequest(request('https://accord.example.test',{'sec-fetch-site':'cross-site'}),loader)).status,403);assert.equal(calls,0);
  const denied=await handleGranolaRequest(request('https://accord.example.test'),loader);assert.equal(denied.status,401);assert.equal(denied.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
});
test('HTTP rejects malformed, oversized, unknown and wrong-method actions without accessing notes',async()=>{
  const f=await connected(),loader=async()=>f.g,url='https://accord.example.test/api/integrations/granola',headers={Origin:'https://accord.example.test','Content-Type':'application/json'};
  const count=f.calls.length;
  assert.equal((await handleGranolaRequest(new Request(url,{method:'POST',headers,body:'invalid'}),loader)).status,400);
  assert.equal((await handleGranolaRequest(new Request(url,{method:'POST',headers,body:JSON.stringify({action:'unknown',args:{}})}),loader)).status,400);
  assert.equal((await handleGranolaRequest(new Request(url,{method:'POST',headers,body:'x'.repeat(128*1024+1)}),loader)).status,413);
  assert.equal((await handleGranolaRequest(new Request(url,{method:'DELETE'}),loader)).status,405);assert.equal(f.calls.length,count);
});
test('HTTP status is owner-scoped and omits credentials, drafts and OAuth details',async()=>{
  const f=await connected(),request=new Request('https://accord.example.test/api/integrations/granola');
  const result=await handleGranolaRequest(request,async()=>f.g),body=await result.json();assert.equal(body.status,'connected');assert.ok(!JSON.stringify(body).includes('synthetic_access'));assert.equal(body.credential,undefined);assert.equal(body.details,undefined);
  const other=await handleGranolaRequest(request,async()=>f.other);assert.equal((await other.json()).status,'not_connected');
});
