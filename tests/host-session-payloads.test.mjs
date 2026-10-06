import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccordHost} from '../lib/host.ts';
import {handleMcpPost} from '../lib/mcp-http.ts';
import {agentPageByteBudget} from '../lib/workspace.ts';
import {pair} from './helpers/workspace.mjs';

const stamp=i=>new Date(Date.UTC(2026,9,1,12,0,Math.floor(i/3))).toISOString();
async function fixture(character,count=141){
  const f=await pair(),host=new AccordHost(f.a);
  const sibling=await f.a.human('add_agent',{name:'Another profile',provider:'Synthetic'});
  const purpose=character.repeat(2000),outcome=character.repeat(4000);
  const insert=f.db.sqlite.prepare('INSERT INTO host_visits (id,owner_id,agent_id,purpose,service,status,outcome,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const ids=[];
  for(let i=0;i<count;i++){
    const id='large-visit-'+String(i).padStart(3,'0');ids.push(id);
    insert.run(id,f.a.user.id,f.sender.id,purpose,'continuity',i%2?'departed':'arrived',outcome,stamp(i),stamp(i));
  }
  insert.run('sibling-private',f.a.user.id,sibling.id,'Other profile purpose','continuity','departed','Other profile outcome',stamp(0),stamp(0));
  insert.run('foreign-private',f.b.user.id,f.recipient.id,'Foreign purpose','continuity','departed','Foreign outcome',stamp(0),stamp(0));
  return {...f,host,sibling,purpose,outcome,ids};
}

async function invoke(f,args,id=1){
  const body=JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'list_sessions',arguments:{agent_id:f.sender.id,...args}}});
  assert.ok(Buffer.byteLength(body)<=128*1024);
  const response=await handleMcpPost(new Request('https://accord.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body}),async()=>f.a);
  assert.equal(response.status,200);
  const raw=await response.text(),message=JSON.parse(raw);
  assert.equal(message.result.isError,undefined);
  assert.deepEqual(JSON.parse(message.result.content[0].text),message.result.structuredContent);
  assert.ok(Buffer.byteLength(raw)<=agentPageByteBudget,'the complete duplicated MCP result and request ID must fit the page budget');
  return message.result.structuredContent;
}

for(const [label,character] of [['CJK','漢'],['escaped controls','\u0001']])test(`private agent session pages preserve maximum ${label} purpose and outcomes at limits 20 and 100`,async()=>{
  const f=await fixture(character);
  try{
    for(const limit of [20,100]){
      let cursor,all=[],shortened=false,pages=0;
      do{
        // This valid request ID occupies almost the entire input allowance. Its
        // escaped output is included in the complete response-byte assertion.
        const page=await invoke(f,{limit,...(cursor?{cursor}:{})},pages?pages:'\\'.repeat(65000));
        assert.ok(page.sessions.length>0&&page.sessions.length<=limit);
        assert.equal(page.oversized_record,undefined);
        assert.match(page.note,/Private sessions for this profile only/);
        for(const row of page.sessions){
          assert.equal(row.purpose,f.purpose);assert.equal(row.outcome,f.outcome);
          assert.equal(row.owner_id,f.a.user.id);assert.equal(row.agent_id,f.sender.id);
          assert.equal(Object.hasOwn(row,'version'),false,'session reads must not invent a revision counter');
        }
        if(page.next_cursor&&page.sessions.length<limit)shortened=true;
        all.push(...page.sessions);cursor=page.next_cursor;
        assert.ok(++pages<=f.ids.length,'each nonterminal page must advance');
      }while(cursor);
      assert.deepEqual(all.map(row=>row.id),f.ids);assert.equal(new Set(all.map(row=>row.id)).size,f.ids.length);
      if(limit===100||label==='escaped controls')assert.equal(shortened,true,'large pages should end at whole-record byte boundaries');
    }
  }finally{f.db.sqlite.close();}
});

test('byte-bounded sessions preserve historical cursor scope and status filtering',async()=>{
  const f=await fixture('漢',45);
  try{
    const scope=JSON.stringify(['sessions',f.a.user.id,f.sender.id,'']);
    const cursor=Buffer.from(JSON.stringify({v:1,scope,at:stamp(4),id:f.ids[4]})).toString('base64url');
    const continued=await f.host.agentSessions({agent_id:f.sender.id,limit:20,cursor});
    assert.equal(continued.sessions[0].id,f.ids[5]);
    const first=await f.host.agentSessions({agent_id:f.sender.id,limit:1});
    const decoded=JSON.parse(Buffer.from(first.next_cursor,'base64url').toString());
    assert.deepEqual(decoded,{v:1,scope,at:stamp(0),id:f.ids[0]});
    await assert.rejects(f.host.agentSessions({agent_id:f.sibling.id,cursor:first.next_cursor}));
    await assert.rejects(f.host.agentSessions({agent_id:f.sender.id,status:'closed',cursor:first.next_cursor}));
    for(const status of ['open','closed']){
      let next,rows=[];
      do{const page=await f.host.agentSessions({agent_id:f.sender.id,status,limit:20,...(next?{cursor:next}:{})});rows.push(...page.sessions);next=page.next_cursor;}while(next);
      assert.deepEqual(rows.map(row=>row.id),f.ids.filter((_,i)=>status==='closed'?i%2:!(i%2)));
    }
  }finally{f.db.sqlite.close();}
});

for(const mutation of ['revoked profile','changed profile owner','changed session owner','changed session content'])test(`private session detail fetch rejects ${mutation} between metadata and selected records`,async()=>{
  const f=await fixture('漢',3),all=f.a.all.bind(f.a);let intercepted=false;
  f.a.all=async(sql,...values)=>{
    const rows=await all(sql,...values);
    if(sql.includes('FROM host_visits v JOIN agents')&&sql.includes('AS payload_bytes')){
      intercepted=true;f.a.all=all;
      if(mutation==='revoked profile')f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.sender.id);
      if(mutation==='changed profile owner')f.db.sqlite.prepare('UPDATE agents SET owner_id=? WHERE id=?').run(f.b.user.id,f.sender.id);
      if(mutation==='changed session owner')f.db.sqlite.prepare('UPDATE host_visits SET owner_id=? WHERE id=?').run(f.b.user.id,f.ids[0]);
      if(mutation==='changed session content')f.db.sqlite.prepare('UPDATE host_visits SET outcome=?,updated_at=? WHERE id=?').run('Changed outcome','2026-10-02T00:00:00.000Z',f.ids[0]);
    }
    return rows;
  };
  try{
    await assert.rejects(f.host.agentSessions({agent_id:f.sender.id,limit:20}),error=>error.status===409&&!error.message.includes(f.purpose));
    assert.equal(intercepted,true);
    if(mutation==='changed session content'){
      const retried=await f.host.agentSessions({agent_id:f.sender.id,limit:20});
      assert.equal(retried.sessions[0].outcome,'Changed outcome');assert.equal(retried.sessions.length,3);
    }
  }finally{f.db.sqlite.close();}
});
