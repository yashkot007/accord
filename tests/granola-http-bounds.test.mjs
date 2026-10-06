import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGranolaRequest} from '../lib/granola-http.ts';
import {AppError} from '../lib/workspace.ts';
import {GranolaRequestBudget} from '../lib/granola-mcp.ts';

const url='https://accord.example.test/api/integrations/granola';
const headers={Origin:'https://accord.example.test','Content-Type':'application/json'};
const bytes=value=>new TextEncoder().encode(value);
const request=(body,options={})=>new Request(url,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body),...options});

test('exact JSON media types and same-origin headers are checked before body reads or service loading',async()=>{
  for(const [type,origin,site,status] of [
    ['application/jsonp',headers.Origin,undefined,400],['text/application/json',headers.Origin,undefined,400],
    ['application/json',undefined,undefined,403],['application/json','https://foreign.example',undefined,403],
    ['application/json',headers.Origin,'cross-site',403],
  ]){
    let loaded=0,pulls=0,cancelled=false;
    const body=new ReadableStream({pull(){pulls++;},cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
    const input=request('',{body,duplex:'half',headers:{'Content-Type':type,...(origin?{Origin:origin}:{}),...(site?{'sec-fetch-site':site}:{})}});
    const response=await handleGranolaRequest(input,async()=>{loaded++;return{};});
    assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(loaded,0);assert.equal(pulls,0);assert.equal(cancelled,true);
  }
});

test('wrong HTTP methods discard unread bodies without awaiting cancellation or loading services',async()=>{
  let loaded=0,cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
  const response=await handleGranolaRequest(new Request(url,{method:'DELETE',body,duplex:'half'}),async()=>{loaded++;return{};});
  assert.equal(response.status,405);assert.equal(cancelled,true);assert.equal(loaded,0);
});

test('malformed envelopes and unknown actions cannot resolve authenticated services',async()=>{
  for(const body of ['invalid','null','[]',JSON.stringify({action:'connect'}),JSON.stringify({action:'connect',args:[]}),JSON.stringify({action:'unknown',args:{}})]){
    let loaded=0;const response=await handleGranolaRequest(request(body),async()=>{loaded++;return{};});assert.equal(response.status,400);assert.equal(loaded,0);
  }
});

test('every action dispatches once and authentication/status errors retain their real response',async()=>{
  for(const [action,method] of [['connect','start'],['disconnect','disconnect'],['tools','tools'],['preview','preview'],['share','share']]){
    let loaded=0,called=0;const args={synthetic:'selected input'},provider={[method]:async(...inputs)=>{called++;if(action==='connect')assert.equal(inputs[0],'https://accord.example.test');else if(action==='preview'||action==='share')assert.deepEqual(inputs[0],args);else if(action==='disconnect')assert.equal(inputs.length,0);return{ok:true};}};
    const response=await handleGranolaRequest(request({action,args}),async()=>{loaded++;return provider;});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(loaded,1);assert.equal(called,1);
  }
  const denied=await handleGranolaRequest(request({action:'tools',args:{}}),async()=>{throw new AppError('Sign in.',401);});assert.equal(denied.status,401);assert.deepEqual(await denied.json(),{error:'Sign in.'});
  let status=0;const response=await handleGranolaRequest(new Request(url),async()=>({status:async()=>{status++;return{status:'connected'};}}));assert.equal(response.status,200);assert.equal(status,1);
});

test('connect, tools and preview share the entry budget including elapsed upload and authentication',async()=>{
  for(const [action,method] of [['connect','start'],['tools','tools'],['preview','preview']]){
    let clock=0,seen;
    const budget=new GranolaRequestBudget(18000,()=>clock);
    const body=new ReadableStream({pull(controller){clock=3000;controller.enqueue(bytes(JSON.stringify({action,args:{tool:'synthetic',parameters:{}}})));controller.close();}},{highWaterMark:0});
    const response=await handleGranolaRequest(request('',{body,duplex:'half'}),async()=>{clock=7000;return{[method]:async(...inputs)=>{seen=inputs.at(-1);return{remaining:seen.remainingMs()};}};},budget);
    assert.equal(response.status,200);assert.equal(seen,budget);assert.deepEqual(await response.json(),{remaining:11000});
  }
});

test('share and disconnect preserve actual write settlement when an upstream-only budget has expired',async()=>{
  for(const action of ['share','disconnect']){
    let clock=0,settled=false;
    const budget=new GranolaRequestBudget(18000,()=>clock);clock=30000;
    const response=await handleGranolaRequest(request({action,args:{draft_id:'receipt'}}),async()=>({[action]:async()=>{settled=true;return{saved:true};}}),budget);
    assert.equal(response.status,200);assert.equal(settled,true);assert.deepEqual(await response.json(),{saved:true});
  }
});

test('maximum valid reviewed excerpt envelopes survive CJK, supplementary Unicode and JSON control escaping',async()=>{
  for(const content of ['界'.repeat(18500),'🚀'.repeat(9250),'\u0001'.repeat(18500)]){
    const args={draft_id:'d'.repeat(100),space_id:'s'.repeat(100),title:'\u0001'.repeat(120),content},body=JSON.stringify({action:'share',args});
    assert.equal(content.length,18500);assert.ok(bytes(body).length<128*1024);
    let shared=0;
    const response=await handleGranolaRequest(request(body,{headers:{...headers,'Content-Type':'Application/JSON; charset=utf-8'}}),async()=>({share:async actual=>{shared++;assert.deepEqual(actual,args);return{saved:true};}}));
    assert.equal(response.status,200);assert.equal(shared,1);assert.deepEqual(await response.json(),{saved:true});
  }
});

test('byte limits stop oversized declared, chunked and understated uploads before service loading',async()=>{
  for(const declared of [undefined,'1','200000']){
    let loaded=0,cancelled=false,pulls=0;
    const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(bytes('x'.repeat(70000)));},cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
    const input=request('',{body,duplex:'half',headers:{...headers,...(declared?{'Content-Length':declared}:{})}});
    const response=await handleGranolaRequest(input,async()=>{loaded++;return{};});
    assert.equal(response.status,413);assert.equal(loaded,0);assert.equal(cancelled,true);assert.equal(pulls,declared==='200000'?0:2);
  }
});

test('stalled uploads time out at five seconds even when cancellation never settles',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let loaded=0,cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
  const pending=handleGranolaRequest(request('',{body,duplex:'half'}),async()=>{loaded++;return{};});
  t.mock.timers.tick(5000);const response=await pending;
  assert.equal(response.status,408);assert.equal(loaded,0);assert.equal(cancelled,true);assert.equal(body.locked,false);assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('trickled chunks cannot extend the upload deadline; a complete request then recovers',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let loaded=0,controller;
  const body=new ReadableStream({start(value){controller=value;}});
  const load=async()=>{loaded++;return{tools:async()=>({tools:[]})};};
  const pending=handleGranolaRequest(request('',{body,duplex:'half'}),load);
  t.mock.timers.tick(3000);controller.enqueue(bytes('{"action":"tools",'));await Promise.resolve();
  t.mock.timers.tick(2000);assert.equal((await pending).status,408);assert.equal(loaded,0);
  const recovered=await handleGranolaRequest(request({action:'tools',args:{}}),load);assert.equal(recovered.status,200);assert.equal(loaded,1);
});

test('pre-aborted and interrupted uploads do not perform any provider or service work',async()=>{
  for(const before of [true,false]){
    let loaded=0;const controller=new AbortController();if(before)controller.abort();
    const body=new ReadableStream({cancel(){return new Promise(()=>{});}},{highWaterMark:0});
    const pending=handleGranolaRequest(request('',{body,duplex:'half',signal:controller.signal}),async()=>{loaded++;return{};});
    if(!before)controller.abort();assert.equal((await pending).status,400);assert.equal(loaded,0);
  }
});
