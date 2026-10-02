import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMcpPost,mcpMethodNotAllowed,protocolVersions} from '../lib/mcp-http.ts';
import {AppError} from '../lib/workspace.ts';
import {pair} from './helpers/workspace.mjs';

function request(message,headers={}){return new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream',...headers},body:JSON.stringify(message)});}
const call=(name,args={},id=1)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const initialization=version=>({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'independent-contract-client',version:'1'}}});

test('valid MCP initialization, discovery and notifications do not resolve private identity',async()=>{
  let reads=0;const service=async()=>{reads++;throw Error('Unexpected private access');};
  for(const version of protocolVersions){const response=await handleMcpPost(request(initialization(version)),service);assert.equal(response.status,200);assert.equal((await response.json()).result.protocolVersion,version);assert.equal(response.headers.get('Cache-Control'),'no-store');}
  const fallback=await handleMcpPost(request(initialization('future-version')),service);assert.equal((await fallback.json()).result.protocolVersion,protocolVersions[0]);
  const listed=await handleMcpPost(request({jsonrpc:'2.0',id:'list',method:'tools/list'}),service),body=await listed.json();
  assert.equal(body.id,'list');assert.equal(body.result.tools.some(t=>t.name==='list_sessions'),true);
  const inbox=body.result.tools.find(t=>t.name==='read_inbox');assert.equal(inbox.inputSchema.properties.limit.maximum,100);assert.equal(inbox.title,'Read inbox');
  const done=await handleMcpPost(request({jsonrpc:'2.0',method:'notifications/initialized'}),service);assert.equal(done.status,202);assert.equal(await done.text(),'');
  // A tool-shaped notification must never execute a write.
  const notification=call('connect_agent',{agent_id:'a'});delete notification.id;
  assert.equal((await handleMcpPost(request(notification),service)).status,202);assert.equal(reads,0);
  assert.equal(mcpMethodNotAllowed().status,405);assert.equal(mcpMethodNotAllowed().headers.get('Allow'),'POST');
});

test('malformed IDs, envelopes and tool inputs never reach the authenticated service',async()=>{
  let calls=0;const service=async()=>{calls++;throw Error('Should not resolve identity');};
  for(const id of [null,{},[],1.5,true,9007199254740992]){
    const response=await handleMcpPost(request(call('connect_agent',{agent_id:'a'},id)),service);
    assert.equal(response.status,400);const body=await response.json();assert.equal(body.error.code,-32600);assert.equal(Object.hasOwn(body,'id'),false);
  }
  for(const message of [[],null,{jsonrpc:'1.0',id:1,method:'ping'},{jsonrpc:'2.0',id:1,method:'ping',params:[]},{jsonrpc:'2.0',id:1,method:'initialize',params:{}},call('list_my_agents',null),call('read_inbox',{agent_id:'a',limit:101}),call('read_inbox',{agent_id:'a',limit:1.5}),call('read_inbox',{agent_id:'a',status:'completed'}),call('connect_agent',{}),call('connect_agent',{agent_id:'a',constructor:'unexpected'}),JSON.parse('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"connect_agent","arguments":{"agent_id":"a","__proto__":{}}}}')]){
    const body=await(await handleMcpPost(request(message),service)).json();assert.ok(body.error||body.result?.isError,JSON.stringify(message));
  }
  assert.equal(calls,0);
});

test('transport rejects cross-origin, unsupported versions, invalid JSON and oversized bodies',async()=>{
  const service=async()=>{throw Error('Private service must not run');};
  assert.equal((await handleMcpPost(request(initialization(protocolVersions[0]),{Origin:'https://other.example'}),service)).status,403);
  assert.equal((await handleMcpPost(request(initialization(protocolVersions[0]),{'MCP-Protocol-Version':'invalid'}),service)).status,400);
  const invalid=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  const parseError=await(await handleMcpPost(invalid,service)).json();assert.equal(parseError.error.code,-32700);assert.equal(Object.hasOwn(parseError,'id'),false);
  const oversized=new Request('https://accord.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(128*1024+1)});
  const tooLarge=await handleMcpPost(oversized,service);assert.equal(tooLarge.status,413);assert.equal(Object.hasOwn(await tooLarge.json(),'id'),false);
  const wrongType=await handleMcpPost(request(initialization(protocolVersions[0]),{'Content-Type':'text/plain'}),service);assert.equal(wrongType.status,415);assert.equal(Object.hasOwn(await wrongType.json(),'id'),false);
  const knownId=await handleMcpPost(request({jsonrpc:'2.0',id:0,method:'missing'}),service);assert.equal((await knownId.json()).id,0);
});

test('HTTP tool exchange preserves identity, duplicate safety, owner decisions and recoverable errors',async()=>{
  const f=await pair();let sequence=0;
  const invoke=async(w,name,args)=>{const r=await handleMcpPost(request(call(name,args,++sequence)),async()=>w);assert.equal(r.status,200);return(await r.json()).result;};
  const arrival=await invoke(f.a,'arrive_at_accord',{agent_id:f.sender.id,purpose:'Review a boundary',service:'perspective',request_id:'visit'});
  assert.equal(arrival.isError,undefined);
  const recovered=await invoke(f.a,'list_sessions',{agent_id:f.sender.id,status:'open'});assert.equal(recovered.structuredContent.sessions[0].id,arrival.structuredContent.visit.id);
  const crossed=await invoke(f.b,'list_sessions',{agent_id:f.sender.id});assert.equal(crossed.isError,true);
  const args={agent_id:f.sender.id,grant_id:f.grant.id,title:'Check delivery',body:'Trace possible duplicate side effects.',request_id:'http-retry'};
  const first=await invoke(f.a,'send_instruction',args),repeat=await invoke(f.a,'send_instruction',args);
  assert.deepEqual(first.structuredContent,repeat.structuredContent);
  const inbox=await invoke(f.b,'read_inbox',{agent_id:f.recipient.id,limit:1});assert.equal(inbox.structuredContent.instructions[0].id,first.structuredContent.id);
  const progress=await invoke(f.b,'report_progress',{agent_id:f.recipient.id,task_id:first.structuredContent.id,status:'completed',feedback:'Traced and documented.'});assert.equal(progress.structuredContent.status,'completed');
  const context=await invoke(f.a,'propose_context_change',{agent_id:f.sender.id,grant_id:f.grant.id,title:'Side effects first',instruction:'Trace external side effects before selecting a transport.',reason:'Duplicate delivery can cross a boundary.',request_id:'context'});
  assert.equal((await invoke(f.b,'read_context',{agent_id:f.recipient.id})).structuredContent.context.length,0);
  await f.b.human('decide_context',{change_id:context.structuredContent.id,expected_version:0,decision:'accepted',instruction:'Trace external side effects first.'});
  const accepted=await invoke(f.b,'read_context',{agent_id:f.recipient.id});assert.equal(accepted.structuredContent.context[0].version,1);
  assert.deepEqual(JSON.parse(accepted.content[0].text),accepted.structuredContent);
  await f.b.human('revoke_authority',{grant_id:f.grant.id});
  assert.equal((await invoke(f.a,'send_instruction',{...args,request_id:'after-revoke'})).isError,true);
  const denied=await handleMcpPost(request(call('list_my_agents')),async()=>{throw new AppError('Sign in.',401);});assert.equal(denied.status,401);
  f.db.sqlite.close();
});
