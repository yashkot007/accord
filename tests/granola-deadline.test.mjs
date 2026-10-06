import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedJson,GranolaMcp,GranolaRequestBudget,providerFetch,GRANOLA_MCP} from '../lib/granola-mcp.ts';

const never=()=>new Promise(()=>{});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const timeout=error=>error.status===502&&/too long/.test(error.message);
function deadlineClock(t) {
  const timers=new Map();let armed=0,cleared=0;
  const set=globalThis.setTimeout,clear=globalThis.clearTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
    if(ms>12000)return set(callback,ms,...args);
    const key={granolaDeadline:++armed,delay:ms};timers.set(key,()=>callback(...args));return key;
  });
  t.mock.method(globalThis,'clearTimeout',key=>{
    if(key?.granolaDeadline){cleared++;timers.delete(key);}else clear(key);
  });
  return {get armed(){return armed;},get cleared(){return cleared;},get active(){return timers.size;},get remaining(){assert.equal(timers.size,1);return timers.keys().next().value.delay;},expire(){assert.equal(timers.size,1);const [key,fire]=timers.entries().next().value;timers.delete(key);fire();}};
}
const envelope=(id,result)=>JSON.stringify({jsonrpc:'2.0',id,result});

test('a fetch adapter ignoring abort still expires once, with delayed rejection observed',async t=>{
  const clock=deadlineClock(t);let reject,signal,calls=0;
  const fetcher=async(_url,init)=>{calls++;signal=init.signal;return new Promise((_,no)=>{reject=no;});};
  const pending=providerFetch(fetcher,GRANOLA_MCP,{}),rejected=assert.rejects(pending,timeout);
  await tick();assert.equal(calls,1);clock.expire();await rejected;
  assert.equal(signal.aborted,true);assert.equal(clock.active,0);assert.equal(clock.cleared,1);
  reject(Error('synthetic late transport rejection'));await tick();
});

test('a fetch adapter that resolves after expiry has its late body discarded without waiting',async t=>{
  const clock=deadlineClock(t);let resolve,cancelled=0;
  const pending=providerFetch(async()=>new Promise(yes=>{resolve=yes;}),GRANOLA_MCP,{}),rejected=assert.rejects(pending,timeout);
  await tick();clock.expire();await rejected;
  resolve(new Response(new ReadableStream({cancel(){cancelled++;return never();}})));
  await tick();assert.equal(cancelled,1);assert.equal(clock.active,0);
});

test('a body adapter ignoring cancel expires, releases its lock and observes a delayed read rejection',async t=>{
  const clock=deadlineClock(t);let reject,cancelled=0,released=0;
  const reader={read:()=>new Promise((_,no)=>{reject=no;}),cancel(){cancelled++;return never();},releaseLock(){released++;}};
  const pending=boundedJson(async()=>({ok:true,body:{getReader:()=>reader}}),GRANOLA_MCP,{}),rejected=assert.rejects(pending,timeout);
  await tick();assert.equal(typeof reject,'function');clock.expire();await rejected;
  assert.ok(cancelled>=1);assert.equal(released,1);assert.equal(clock.active,0);
  reject(Error('synthetic delayed body rejection'));await tick();
});

test('JSON headers and body share one total deadline and synthetic cancellation EOF cannot succeed',async t=>{
  const clock=deadlineClock(t);let resolveHeaders,body,cancelled=0,signal;
  const pending=boundedJson(async(_url,init)=>{signal=init.signal;return new Promise(yes=>{resolveHeaders=yes;});},GRANOLA_MCP,{}),rejected=assert.rejects(pending,timeout);
  await tick();assert.equal(clock.armed,1);
  resolveHeaders(new Response(new ReadableStream({start(controller){body=controller;controller.enqueue(new TextEncoder().encode('{"unfinished":'));},cancel(){cancelled++;return never();}})));
  await tick();assert.equal(clock.armed,1,'the body must not start a fresh deadline');
  assert.ok(body);clock.expire();await rejected;
  assert.equal(signal.aborted,true);assert.equal(cancelled,1);assert.equal(clock.active,0);assert.equal(clock.cleared,1);
});

test('JSON chunks never reset the deadline and oversized input rejects despite stalled cancellation',async t=>{
  const clock=deadlineClock(t);let body,cancelled=0;
  const pending=boundedJson(async()=>new Response(new ReadableStream({start(controller){body=controller;},cancel(){cancelled++;return never();}})),GRANOLA_MCP,{}),rejected=assert.rejects(pending,timeout);
  await tick();for(let i=0;i<4;i++){body.enqueue(new TextEncoder().encode(' '));await tick();}
  assert.equal(clock.armed,1);clock.expire();await rejected;assert.equal(cancelled,1);
  const huge=boundedJson(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(256*1024+1));},cancel(){cancelled++;return never();}})),GRANOLA_MCP,{});
  await assert.rejects(huge,{status:413});assert.equal(clock.active,0);assert.equal(cancelled,2);
});

test('upstream error and redirect statuses do not wait for cancellation or retry',async t=>{
  const clock=deadlineClock(t);let calls=0,cancelled=0;
  for(const [status,expected] of [[401,401],[429,429],[307,502],[500,502]]) {
    await assert.rejects(providerFetch(async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(new ReadableStream({cancel(){cancelled++;return never();}}),{status});},GRANOLA_MCP,{}),{status:expected});
    assert.equal(clock.active,0);
  }
  assert.equal(calls,4);assert.equal(cancelled,4);assert.equal(clock.cleared,4);
});

test('a stalled MCP SSE stream expires and cleanup releases its reader',async t=>{
  const clock=deadlineClock(t);let stream,cancelled=0;
  const mcp=new GranolaMcp('synthetic',async()=>{
    stream=new ReadableStream({cancel(){cancelled++;return never();}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  });
  const pending=mcp.rpc('tools/list'),rejected=assert.rejects(pending,timeout);
  await tick();assert.equal(stream.locked,true);clock.expire();await rejected;
  assert.equal(cancelled,1);assert.equal(stream.locked,false);assert.equal(clock.active,0);
});

test('a complete SSE result returns immediately even when its open stream cannot finish cancellation',async t=>{
  const clock=deadlineClock(t);let stream,cancelled=0,calls=0;
  const mcp=new GranolaMcp('synthetic',async(_url,init)=>{
    calls++;const {id}=JSON.parse(init.body);
    stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+envelope(id,{tools:[]})+'\n\n'));},cancel(){cancelled++;return never();}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  });
  assert.deepEqual(await mcp.rpc('tools/list'),{tools:[]});
  assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(stream.locked,false);assert.equal(clock.active,0);assert.equal(clock.cleared,1);
});

test('initialized notification discards its body without waiting and clears the deadline',async t=>{
  const clock=deadlineClock(t);let cancelled=0,calls=0;
  const mcp=new GranolaMcp('synthetic',async(_url,init)=>{calls++;assert.equal(JSON.parse(init.body).id,undefined);return new Response(new ReadableStream({cancel(){cancelled++;return never();}}),{status:202});});
  assert.equal(await mcp.rpc('notifications/initialized',{},true),null);
  assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(clock.active,0);assert.equal(clock.cleared,1);
});

test('malformed JSON or SSE fails without waiting for cancellation and clears all timers',async t=>{
  const clock=deadlineClock(t);let cancelled=0;
  const json=boundedJson(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([0xff]));},cancel(){cancelled++;return never();}})),GRANOLA_MCP,{});
  await assert.rejects(json,{status:502});assert.equal(clock.active,0);
  const mcp=new GranolaMcp('synthetic',async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: invalid json\n\n'));},cancel(){cancelled++;return never();}}),{headers:{'Content-Type':'text/event-stream'}}));
  await assert.rejects(mcp.rpc('tools/list'),{status:502});assert.equal(cancelled,2);assert.equal(clock.active,0);
});

test('successful bounded JSON clears its deadline and retains the complete value',async t=>{
  const clock=deadlineClock(t),expected={notes:'文😀\\\"'.repeat(1000)};
  assert.deepEqual(await boundedJson(async()=>Response.json(expected),GRANOLA_MCP,{}),expected);
  assert.equal(clock.armed,1);assert.equal(clock.active,0);assert.equal(clock.cleared,1);
});

test('sequential requests reuse an absolute workflow budget while retaining each 12-second ceiling',async t=>{
  const clock=deadlineClock(t);let now=0,calls=0;
  const budget=new GranolaRequestBudget(18000,()=>now);
  assert.deepEqual(await boundedJson(async()=>{calls++;assert.equal(clock.remaining,12000);now=8000;return Response.json({first:true});},GRANOLA_MCP,{},budget),{first:true});
  const pending=boundedJson(async()=>{calls++;assert.equal(clock.remaining,10000);return new Response(new ReadableStream({cancel:never}));},GRANOLA_MCP,{},budget),rejected=assert.rejects(pending,timeout);
  await tick();assert.equal(clock.remaining,10000);now=18000;clock.expire();await rejected;
  await assert.rejects(boundedJson(async()=>{calls++;return Response.json({unexpected:true});},GRANOLA_MCP,{},budget),timeout);
  assert.equal(calls,2,'an expired shared budget must reject before another upstream call');assert.equal(clock.active,0);
  assert.throws(()=>budget.assertActive(),timeout);
});

test('MCP discovery pages inherit one budget and cannot reset it before a note read',async t=>{
  const clock=deadlineClock(t);let now=0,calls=0;
  const budget=new GranolaRequestBudget(18000,()=>now),tools=[{name:'query_granola_meetings',inputSchema:{type:'object',properties:{}}}];
  const mcp=new GranolaMcp('synthetic',async(_url,init)=>{
    calls++;const request=JSON.parse(init.body);assert.ok(clock.remaining<=12000);
    now+=5000;
    if(request.method==='initialize')return Response.json(JSON.parse(envelope(request.id,{protocolVersion:'2025-06-18'})));
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json(JSON.parse(envelope(request.id,{tools,nextCursor:'another-page'})));
  },budget);
  await mcp.initialize();await assert.rejects(mcp.tools(),timeout);
  assert.equal(calls,4,'only discovery calls occur; no later note request is authorized by a reset timer');assert.equal(clock.active,0);
  await assert.rejects(mcp.call(tools[0],{}),timeout);assert.equal(calls,4);
});

test('workflow clock reversal never replenishes a used budget and invalid budgets are rejected',()=>{
  let now=100;const budget=new GranolaRequestBudget(5000,()=>now);
  now=4100;assert.equal(budget.remainingMs(),1000);now=200;assert.equal(budget.remainingMs(),1000);
  for(const ms of [0,-1,NaN,Infinity,1.5])assert.throws(()=>new GranolaRequestBudget(ms),RangeError);
});
