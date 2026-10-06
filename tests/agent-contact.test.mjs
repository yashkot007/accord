import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pair, database} from './helpers/workspace.mjs';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {agentContactIntervalMs} from '../lib/workspace.ts';
import {AccordHost} from '../lib/host.ts';

const at=Date.parse('2026-10-06T06:00:00.000Z');
const request=(name,args)=>new Request('https://accord.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
const profile=(f,id=f.recipient.id)=>f.db.sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);

test('repeated authenticated MCP polling records one contact without changing shared work',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());t.mock.method(Date,'now',()=>at);
  const events=f.db.sqlite.prepare('SELECT count(*) AS total FROM events').get().total;
  let statements=0,contacts=0;const prepare=f.db.prepare;
  f.db.prepare=sql=>{statements++;if(sql.startsWith('UPDATE agents SET status=\'connected\''))contacts++;return prepare(sql);};
  for(let i=0;i<10;i++){
    const response=await handleMcpPost(request('read_context',{agent_id:f.recipient.id}),async()=>f.b);
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.result.isError,undefined);assert.deepEqual(body.result.structuredContent.context,[]);
  }
  assert.equal(profile(f).contact_version,1);assert.equal(profile(f).last_seen_at,new Date(at).toISOString());
  assert.equal(contacts,1);assert.equal(statements,21,'one current profile check per poll plus its bounded read; only the first poll persists contact');
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS total FROM events').get().total,events);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS total FROM tasks').get().total,0);
});

test('normal contact refreshes at the interval boundary and keeps the display timestamp monotonic',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());let clock=at;t.mock.method(Date,'now',()=>clock);
  await f.b.touchAgent(f.recipient.id);clock+=agentContactIntervalMs-1;
  await f.b.touchAgent(f.recipient.id);assert.equal(profile(f).contact_version,1);
  clock++;await f.b.touchAgent(f.recipient.id);assert.equal(profile(f).contact_version,2);
  const latest=profile(f).last_seen_at;clock-=60_000;
  await f.b.touchAgent(f.recipient.id);assert.equal(profile(f).last_seen_at,latest);assert.equal(profile(f).contact_version,2);
});

test('explicit connections produce fresh counters even with tied timestamps or a backward clock',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());let clock=at;t.mock.method(Date,'now',()=>clock);
  const first=await f.b.agentTool('connect_agent',{agent_id:f.recipient.id});
  const tied=await f.b.agentTool('connect_agent',{agent_id:f.recipient.id});
  assert.equal(first.contact_version,1);assert.equal(tied.contact_version,2);assert.equal(tied.last_seen_at,first.last_seen_at);
  clock-=60_000;const backwards=await f.b.agentTool('connect_agent',{agent_id:f.recipient.id});
  assert.equal(backwards.contact_version,3);assert.equal(backwards.last_seen_at,first.last_seen_at);
  const state=await f.b.humanProfile(f.recipient.id,f.space.id);
  assert.equal(state.profile.contact_version,3);assert.equal(state.attached,true);
  assert.equal(state.profile.status,'connected');
});

test('concurrent first contacts coalesce at the conditional write without an ownership cache',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());t.mock.method(Date,'now',()=>at);
  const results=await Promise.all(Array.from({length:20},()=>f.b.touchAgent(f.recipient.id)));
  assert.equal(profile(f).contact_version,1);assert.ok(results.every(r=>r.contact_version===1&&r.status==='connected'));
  await f.b.human('disconnect_agent',{agent_id:f.recipient.id});
  await assert.rejects(f.b.touchAgent(f.recipient.id),e=>e.status===403);
  assert.equal(profile(f).status,'revoked');assert.equal(profile(f).contact_version,1);
});

test('a delayed earlier contact cannot overwrite a newer recorded timestamp',async t=>{
  let clock=at;t.mock.method(Date,'now',()=>clock);
  for(const force of [false,true]){
    const f=await pair();clock=at;
    let reached,release;const arrived=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>release=resolve);
    const one=f.b.one.bind(f.b);let delayed=false;
    f.b.one=async(sql,...values)=>{if(!delayed&&sql.startsWith('UPDATE agents SET status=\'connected\'')){delayed=true;reached();await gate;}return one(sql,...values);};
    const earlier=f.b.touchAgent(f.recipient.id,force);await arrived;clock=at+1_000;
    const latest=await f.b.touchAgent(f.recipient.id,force);release();const old=await earlier;
    assert.equal(profile(f).last_seen_at,new Date(clock).toISOString());assert.equal(old.last_seen_at,latest.last_seen_at);
    assert.equal(profile(f).contact_version,force?2:1);
    f.db.sqlite.close();
  }
});

test('revocation or owner changes before contact commits fail without reconnecting the profile',async t=>{
  for(const mutation of ['revoked','owner'])for(const force of [false,true]){
    const f=await pair();t.mock.method(Date,'now',()=>at);
    const one=f.b.one.bind(f.b);let changed=false;
    f.b.one=async(sql,...values)=>{if(!changed&&sql.startsWith('UPDATE agents SET status=\'connected\'')){changed=true;f.db.sqlite.prepare(mutation==='revoked'?"UPDATE agents SET status='revoked' WHERE id=?":"UPDATE agents SET owner_id='outsider' WHERE id=?").run(f.recipient.id);}return one(sql,...values);};
    await assert.rejects(f.b.touchAgent(f.recipient.id,force),e=>e.status===403);
    assert.equal(profile(f).contact_version,0);assert.equal(profile(f).last_seen_at,null);
    assert.equal(profile(f)[mutation==='revoked'?'status':'owner_id'],mutation==='revoked'?'revoked':'outsider');
    f.db.sqlite.close();
  }
});

test('host polling uses the same contact policy while human reads never manufacture contact',async t=>{
  const f=await pair();t.after(()=>f.db.sqlite.close());t.mock.method(Date,'now',()=>at);
  const human=new AccordHost(f.b);
  const visit=await human.perform('arrive_at_accord',{agent_id:f.recipient.id,purpose:'Synthetic contact check',service:'continuity'},'human');
  assert.equal(profile(f).contact_version,0);assert.equal(profile(f).status,'pending');
  for(let i=0;i<10;i++)await human.perform('consult_host',{agent_id:f.recipient.id,visit_id:visit.visit.id},'agent');
  assert.equal(profile(f).contact_version,1);assert.equal(profile(f).status,'connected');
  await f.b.humanProfile(f.recipient.id,f.space.id);await f.b.humanRoom(f.space.id);
  assert.equal(profile(f).contact_version,1);
});

test('contact migration preserves historical timestamps, status and record counts',()=>{
  const db=database({through:'0013_human_room_reads.sql'});
  try{
    db.sqlite.prepare('INSERT INTO agents (id,owner_id,name,provider,status,last_seen_at,created_at) VALUES (?,?,?,?,?,?,?)').run('old','owner','Existing profile','Test','revoked',new Date(at).toISOString(),new Date(at).toISOString());
    const before=db.sqlite.prepare('SELECT * FROM agents').all();
    db.sqlite.exec(readFileSync(new URL('../drizzle/0014_agent_contact.sql',import.meta.url),'utf8'));
    const after=db.sqlite.prepare('SELECT * FROM agents').all();assert.equal(after.length,before.length);
    for(const row of after){const {contact_version,...rest}=row;assert.equal(contact_version,0);assert.deepEqual(rest,{...before.find(old=>old.id===row.id)});}
  }finally{db.sqlite.close();}
});
