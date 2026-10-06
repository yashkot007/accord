import {test} from 'node:test';
import assert from 'node:assert/strict';
import {McpDiagnostics,mcpReferenceHeader} from '../lib/mcp-diagnostics.ts';
import {McpAdmission} from '../lib/mcp-admission.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {AppError} from '../lib/workspace.ts';

const zero={bodies:0,tools:0,heavyReads:0,accounts:0};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const call=(name='list_my_agents',args={},id=0)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const request=(message,options={})=>new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message),...options});
const workspace=(execute=async()=>({ok:true}),id='private-account')=>({user:{id},agentTool:execute});
function setup(options={}){
  const events=[];let reference=0;
  const diagnostics=new McpDiagnostics({successSamples:100,failureSamples:100,overloadSamples:100,reference:()=>`00000000-0000-4000-8000-${String(++reference).padStart(12,'0')}`,sink:event=>events.push(event),...options});
  return{events,diagnostics};
}
const last=events=>events.at(-1);

test('only public inventory labels and independent opaque references enter diagnostics',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();
  const privateValues=['RPC_SECRET','REQUEST_SECRET','PROFILE_SECRET','GRANT_SECRET','TITLE_SECRET','BODY_SECRET','OWNER_SECRET','RESULT_SECRET','URL_SECRET','TOKEN_SECRET'];
  const args={agent_id:privateValues[2],grant_id:privateValues[3],title:privateValues[4],body:privateValues[5],request_id:privateValues[1]};
  const input=request(call('send_instruction',args,privateValues[0]),{headers:{'content-type':'application/json',authorization:'Bearer '+privateValues[9],'X-Accord-Request-Reference':privateValues[1]}});
  const response=await handleMcpPost(input,async()=>workspace(async()=>({owner:privateValues[6],body:privateValues[7],url:privateValues[8]}),privateValues[6]),admission,diagnostics);
  const body=await response.json();assert.equal(body.id,privateValues[0]);assert.equal(body.result.structuredContent.body,privateValues[7]);
  assert.equal(response.headers.get(mcpReferenceHeader),'00000000-0000-4000-8000-000000000001');
  assert.equal(last(events).reference,response.headers.get(mcpReferenceHeader));
  assert.equal(last(events).method,'tools/call');assert.equal(last(events).tool,'send_instruction');
  assert.equal(last(events).outcome,'success');assert.equal(last(events).application_status,null);
  for(const value of privateValues)assert.equal(JSON.stringify(events).includes(value),false,value);
  const second=await handleMcpPost(request({jsonrpc:'2.0',id:privateValues[0],method:'ping'}),async()=>{throw Error('Must not authenticate');},admission,diagnostics);
  assert.notEqual(second.headers.get(mcpReferenceHeader),response.headers.get(mcpReferenceHeader));
  assert.deepEqual(admission.usage,zero);
});

test('unknown method/tool/cursor and unexpected exception details are excluded',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();
  const secret='private_dynamic_name_and_cursor';
  const cases=[{jsonrpc:'2.0',id:secret,method:secret},call(secret,{}),{jsonrpc:'2.0',id:0,method:'tools/list',params:{cursor:secret}}];
  for(const message of cases){const response=await handleMcpPost(request(message),async()=>{throw Error('No authentication');},admission,diagnostics);assert.equal(response.status,200);assert.ok((await response.json()).error);}
  const error=new Error(secret);error.name=secret;error.stack=secret;
  const response=await handleMcpPost(request(call()),async()=>workspace(async()=>{throw error;}),admission,diagnostics);
  assert.equal(response.status,503);assert.equal(last(events).reason,'unexpected_failure');assert.equal(last(events).failure_phase,'tool');
  assert.equal(events[0].method,'other');assert.equal(events[1].tool,null);assert.equal(events[2].tool,null);
  assert.equal(JSON.stringify(events).includes(secret),false);assert.deepEqual(admission.usage,zero);
});

test('HTTP 200 business errors retain tool outcomes and application status',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();
  for(const [status,reason] of [[403,'access_denied'],[404,'not_found'],[409,'conflict'],[503,'service_unavailable']]){
    const response=await handleMcpPost(request(call()),async()=>workspace(async()=>{throw new AppError('Private business explanation',status);}),admission,diagnostics);
    assert.equal(response.status,200);assert.equal((await response.json()).result.isError,true);
    assert.deepEqual({outcome:last(events).outcome,status:last(events).status,application:last(events).application_status,reason:last(events).reason,phase:last(events).failure_phase},{outcome:'tool_error',status:200,application:status,reason,phase:'tool'});
    assert.deepEqual(admission.usage,zero);
  }
  assert.equal(JSON.stringify(events).includes('Private business explanation'),false);
});

test('published-schema errors differ from JSON-RPC errors at the same HTTP status',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();let authenticated=0;
  const resolver=async()=>{authenticated++;return workspace();};
  const business=await handleMcpPost(request(call('connect_agent',{})),resolver,admission,diagnostics);
  assert.equal(business.status,200);assert.equal((await business.json()).result.isError,true);
  assert.equal(last(events).outcome,'tool_error');assert.equal(last(events).application_status,400);assert.equal(last(events).failure_phase,'validate');
  const transport=await handleMcpPost(request({jsonrpc:'2.0',id:0,method:'initialize',params:{}}),resolver,admission,diagnostics);
  assert.equal(transport.status,200);assert.ok((await transport.json()).error);assert.equal(last(events).outcome,'transport_error');assert.equal(last(events).application_status,null);
  assert.equal(authenticated,0);assert.deepEqual(admission.usage,zero);
});

test('transport authentication and service failures are classified without private details',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();
  for(const [status,reason] of [[401,'authentication'],[503,'service_unavailable']]){
    const response=await handleMcpPost(request(call()),async()=>{throw new AppError('SECRET_AUTH_DETAIL',status);},admission,diagnostics);
    assert.equal(response.status,status);assert.equal((await response.json()).error.message,'SECRET_AUTH_DETAIL');
    assert.equal(last(events).outcome,'transport_error');assert.equal(last(events).application_status,status);assert.equal(last(events).reason,reason);assert.equal(last(events).failure_phase,'auth');
    assert.deepEqual(admission.usage,zero);
  }
  assert.equal(JSON.stringify(events).includes('SECRET_AUTH_DETAIL'),false);
});

test('admission rejections identify body, tool and account stages without executing excess work',async()=>{
  for(const stage of ['body','tool','account']){
    const {events,diagnostics}=setup(),admission=new McpAdmission({bodies:1,tools:2,perAccount:1});
    const release=stage==='body'?admission.claimBody():stage==='tool'?[admission.claimTool(false),admission.claimTool(false)]:admission.claimAccount('private-account');
    let authenticated=0,executed=0;
    const response=await handleMcpPost(request(call()),async()=>{authenticated++;return workspace(async()=>{executed++;return{};});},admission,diagnostics);
    assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'1');assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(last(events).outcome,'transport_error');assert.equal(last(events).reason,'overload');assert.equal(last(events).admission_stage,stage);assert.equal(last(events).failure_phase,'admission');
    assert.equal(authenticated,stage==='account'?1:0);assert.equal(executed,0);
    if(Array.isArray(release))release.forEach(fn=>fn());else release();assert.deepEqual(admission.usage,zero);
  }
});

test('upload timeout records a body failure and releases capacity even with a broken sink',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0,authenticated=0;const events=[];
  const diagnostics=new McpDiagnostics({clock:()=>now,sink:event=>{events.push(event);throw Error('BROKEN_SINK');}});
  const admission=new McpAdmission(),entered=deferred(),body=new ReadableStream({pull(){entered.resolve();},cancel(){return new Promise(()=>{});}},{highWaterMark:0});
  const pending=handleMcpPost(new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),async()=>{authenticated++;return workspace();},admission,diagnostics);
  await entered.promise;now=5000;t.mock.timers.tick(5000);
  const response=await pending;assert.equal(response.status,408);assert.equal(authenticated,0);assert.equal(events.length,1);assert.equal(events[0].reason,'timeout');assert.equal(events[0].failure_phase,'body');assert.equal(events[0].timings_ms.body,5000);assert.deepEqual(admission.usage,zero);
});

test('abort before dispatch is reported as interrupted rather than a business error',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission(),controller=new AbortController();controller.abort();let auth=0;
  const response=await handleMcpPost(request(call(),{signal:controller.signal}),async()=>{auth++;return workspace();},admission,diagnostics);
  assert.equal(response.status,400);assert.equal(auth,0);assert.equal(last(events).reason,'interrupted');assert.equal(last(events).failure_phase,'body');assert.deepEqual(admission.usage,zero);
});

test('phase timings partition observed body, authentication, tool and serialization intervals',async()=>{
  let now=0;const {events,diagnostics}=setup({clock:()=>now}),admission=new McpAdmission();
  const message=JSON.stringify(call()),body=new ReadableStream({start(controller){now=5;controller.enqueue(new TextEncoder().encode(message));controller.close();}});
  // Construction precedes diagnostics; the reader advances the clock, not start().
  now=0;let read=0;
  const originalGetReader=body.getReader.bind(body);
  body.getReader=()=>{const reader=originalGetReader(),originalRead=reader.read.bind(reader);reader.read=()=>{if(!read++)now+=5;return originalRead();};return reader;};
  const result={toJSON(){now+=3;return{ok:true};}};
  const response=await handleMcpPost(new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),async()=>{now+=7;return workspace(async()=>{now+=11;return result;});},admission,diagnostics);
  assert.equal(response.status,200);assert.deepEqual(last(events).timings_ms,{body:5,auth:7,tool:11,serialize:6});assert.equal(last(events).duration_ms,29);
  assert.equal(last(events).failure_phase,null);assert.deepEqual(admission.usage,zero);
});

test('serialization failure records its phase while retaining the generic response and releasing leases',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission(),cycle={};cycle.self=cycle;
  const response=await handleMcpPost(request(call()),async()=>workspace(async()=>cycle),admission,diagnostics);
  assert.equal(response.status,503);assert.equal((await response.json()).error.message,'The workspace is unavailable. Try again later.');
  assert.equal(last(events).reason,'unexpected_failure');assert.equal(last(events).failure_phase,'serialize');assert.equal(last(events).outcome,'transport_error');assert.deepEqual(admission.usage,zero);
});

test('fixed buckets bound both healthy samples and repeated failures/rejections',()=>{
  let now=0;const events=[],diagnostics=new McpDiagnostics({clock:()=>now,sink:event=>events.push(event)});
  for(let i=0;i<6000;i++){
    const trace=diagnostics.begin();trace.select('unknown_'+i,'private_'+i);trace.phase('tool');
    const kind=i%3;trace.result(kind===0?'success':'transport_error',kind===0?null:kind===1?'unexpected_failure':'overload',null,kind===2?'tool':null);trace.finish(new Response(null,{status:kind===2?429:kind===1?503:200}));trace.finish();
  }
  assert.equal(events.length,14);assert.deepEqual(diagnostics.snapshot,{completed:6000,outcomes:{success:2000,notification:0,transport_error:4000,tool_error:0},admission_rejections:{body:0,tool:2000,account:0},samples:{success:2,failure:8,overload:4},suppressed:5986});
  assert.equal(JSON.stringify(events).includes('private_'),false);assert.ok(events.every(event=>event.method==='other'&&event.tool===null));
  const copy=diagnostics.snapshot;copy.outcomes.success=0;assert.equal(diagnostics.snapshot.outcomes.success,2000);
  now=60_000;assert.equal(events.length,14,'There is no background flush');
  const trace=diagnostics.begin();trace.select('ping');trace.result('success');trace.finish(new Response());
  assert.equal(events.length,16);assert.equal(events[14].event,'accord.mcp.summary');assert.equal(events[14].completed,6000);assert.equal(events[14].suppressed,5986);assert.equal(events[14].window_ms,60000);assert.equal(diagnostics.snapshot.completed,1);
});

test('notification completion is distinct and clock failures cannot produce unbounded timings',async()=>{
  let now=50;const {events,diagnostics}=setup({clock:()=>{if(now===-1)throw Error('CLOCK_SECRET');return now;}}),admission=new McpAdmission();
  for(const value of [50,2,Infinity,NaN,-1]){
    now=value;const response=await handleMcpPost(request({jsonrpc:'2.0',method:'notifications/initialized',params:{secret:'NOTIFICATION_SECRET'}}),async()=>{throw Error('No identity');},admission,diagnostics);
    assert.equal(response.status,202);assert.equal(await response.text(),'');assert.equal(last(events).outcome,'notification');assert.equal(last(events).method,'notification');assert.equal(last(events).duration_ms,0);
    assert.ok(Object.values(last(events).timings_ms).every(value=>Number.isSafeInteger(value)&&value>=0));
  }
  assert.equal(JSON.stringify(events).includes('SECRET'),false);assert.deepEqual(admission.usage,zero);
});

test('UUID failure omits the header and never reuses caller references',async()=>{
  for(const reference of [()=>{throw Error('UUID_SECRET');},()=> 'INVALID_PRIVATE_REFERENCE']){
    const {events,diagnostics}=setup({reference}),response=await handleMcpPost(request({jsonrpc:'2.0',id:'CALLER_REFERENCE',method:'ping'}),async()=>{throw Error('No identity');},new McpAdmission(),diagnostics);
    assert.equal(response.status,200);assert.equal(response.headers.has(mcpReferenceHeader),false);assert.equal(last(events).reference,null);
    assert.equal(JSON.stringify(events).includes('REFERENCE'),false);assert.equal(JSON.stringify(events).includes('SECRET'),false);
  }
});

test('broken header or sink handling cannot change responses or hold execution leases',async t=>{
  const original=Response.json.bind(Response);
  t.mock.method(Response,'json',(...args)=>{const response=original(...args),set=response.headers.set.bind(response.headers);response.headers.set=(name,value)=>{if(name===mcpReferenceHeader)throw Error('HEADER_SECRET');return set(name,value);};return response;});
  const admission=new McpAdmission(),observedUsage=[];
  const diagnostics=new McpDiagnostics({successSamples:100,failureSamples:100,sink:()=>{observedUsage.push(admission.usage);throw Error('SINK_SECRET');}});
  for(const execute of [async()=>({ok:true}),async()=>{throw new AppError('Business rejection',409);},async()=>{throw Error('Private failure');}]){
    const response=await handleMcpPost(request(call()),async()=>workspace(execute),admission,diagnostics);
    assert.equal(response.headers.has(mcpReferenceHeader),false);assert.ok([200,503].includes(response.status));assert.deepEqual(admission.usage,zero);
  }
  assert.deepEqual(observedUsage,[zero,zero,zero]);
});

test('early header and bounded-body failures retain transport status and never resolve identity',async()=>{
  const {events,diagnostics}=setup(),admission=new McpAdmission();let authenticated=0;
  const inputs=[
    [request(call(),{headers:{'content-type':'application/json',origin:'https://PRIVATE_ORIGIN.test'}}),403,'headers','access_denied'],
    [request(call(),{headers:{'content-type':'text/plain'}}),415,'headers','invalid_request'],
    [request(call(),{headers:{'content-type':'application/json','MCP-Protocol-Version':'PRIVATE_VERSION'}}),400,'headers','invalid_request'],
    [request(call(),{body:'x'.repeat(128*1024+1)}),413,'body','invalid_request'],
    [request(call(),{body:'PRIVATE_INVALID_JSON'}),400,'validate','invalid_request'],
  ];
  for(const [input,status,phase,reason] of inputs){
    const response=await handleMcpPost(input,async()=>{authenticated++;return workspace();},admission,diagnostics);
    assert.equal(response.status,status);assert.equal(last(events).outcome,'transport_error');assert.equal(last(events).failure_phase,phase);assert.equal(last(events).reason,reason);assert.deepEqual(admission.usage,zero);
  }
  assert.equal(authenticated,0);assert.equal(JSON.stringify(events).includes('PRIVATE_'),false);
});

test('default console events use one parseable JSON string and fixed event names',async t=>{
  const calls=[];t.mock.method(console,'info',(...values)=>calls.push(values));t.mock.method(console,'error',(...values)=>calls.push(values));
  const diagnostics=new McpDiagnostics();
  await handleMcpPost(request({jsonrpc:'2.0',id:0,method:'ping'}),async()=>{throw Error('No identity');},new McpAdmission(),diagnostics);
  await handleMcpPost(request(call()),async()=>{throw Error('PRIVATE_EXCEPTION');},new McpAdmission(),diagnostics);
  assert.equal(calls.length,2);for(const values of calls){assert.equal(values.length,1);assert.equal(typeof values[0],'string');assert.equal(JSON.parse(values[0]).event,'accord.mcp.completed');assert.equal(values[0].includes('PRIVATE_EXCEPTION'),false);}
});

test('diagnostic initialization failure leaves MCP semantics and cleanup intact',async()=>{
  const admission=new McpAdmission(),diagnostics={begin(){throw Error('BROKEN_DIAGNOSTICS');}};
  const response=await handleMcpPost(request(call()),async()=>workspace(),admission,diagnostics);
  assert.equal(response.status,200);assert.equal((await response.json()).result.structuredContent.ok,true);assert.equal(response.headers.has(mcpReferenceHeader),false);assert.deepEqual(admission.usage,zero);
});
