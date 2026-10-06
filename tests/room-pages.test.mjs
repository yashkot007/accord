import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair} from './helpers/workspace.mjs';
import {AccordHost} from '../lib/host.ts';

const sections=['people','agents','grants','sources','tasks','changes','events'];
const stamp=i=>new Date(Date.UTC(2026,11,1,12,0,Math.floor(i/4))).toISOString();
async function populated(){
  const f=await pair(),sql=f.db.sqlite;
  const source=sql.prepare('INSERT INTO sources (id,space_id,title,content,kind,created_by,created_at) VALUES (?,?,?,?,?,?,?)');
  const task=sql.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const change=sql.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,adopted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const grant=sql.prepare('INSERT INTO grants (id,space_id,from_agent,to_agent,scope,allow_assign,allow_context,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const event=sql.prepare('INSERT INTO events (id,space_id,actor_id,kind,description,created_at) VALUES (?,?,?,?,?,?)');
  const agent=sql.prepare('INSERT INTO agents (id,owner_id,name,provider,status,created_at) VALUES (?,?,?,?,?,?)');
  for(let i=0;i<125;i++){
    const suffix=String(i).padStart(3,'0'),date=stamp(i),personId='!person-'+suffix,profileId='!agent-'+suffix;
    sql.prepare('INSERT INTO people (id,email,name) VALUES (?,?,?)').run(personId,personId+'@example.test','Synthetic person');
    sql.prepare('INSERT INTO members (space_id,user_id,role) VALUES (?,?,?)').run(f.space.id,personId,'participant');
    agent.run(profileId,f.a.user.id,'Synthetic profile','Test','connected',date);
    sql.prepare('INSERT INTO space_agents (space_id,agent_id) VALUES (?,?)').run(f.space.id,profileId);
    source.run('source-'+suffix,f.space.id,'Synthetic source '+suffix,'Full source '+suffix+' '+'s'.repeat(19900),'Note',f.a.user.id,date);
    task.run('task-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Synthetic task '+suffix,'b'.repeat(8000),i%2?'completed':'queued','f'.repeat(8000),'agent',date,date);
    change.run('change-'+suffix,f.space.id,f.grant.id,f.sender.id,f.recipient.id,'Synthetic guidance '+suffix,'p'.repeat(5000),'i'.repeat(5000),'r'.repeat(3000),'Synthetic scope',i%2?'accepted':'pending',i%2?'Adopted '+suffix:null,date,date);
    grant.run('grant-'+suffix,f.space.id,f.sender.id,f.recipient.id,'Synthetic scope',0,1,'active',new Date(Date.now()+86400000).toISOString(),date);
    event.run('event-'+suffix,f.space.id,f.a.user.id,'instruction','Synthetic event '+suffix,date);
  }
  return f;
}

test('room overviews are bounded summaries and every tied-date record remains reachable through indexed pages',async()=>{
  const f=await populated();
  try{
    const whole=await f.a.readSpace(f.space.id),queries=[],all=f.a.all.bind(f.a),one=f.a.one.bind(f.a);
    f.a.all=async(sql,...args)=>{assert.ok(args.length<=100,'query stays inside D1 binding limits');queries.push({sql,args});return all(sql,...args);};
    f.a.one=async(sql,...args)=>{queries.push({sql,args});return one(sql,...args);};
    const overview=await f.a.agentTool('read_space',{space_id:f.space.id,agent_id:f.sender.id});
    assert.equal(overview.summaries,true);assert.ok(JSON.stringify(overview).length<JSON.stringify(whole).length/40,'overview must avoid transferring full source, work and guidance bodies');
    assert.equal(queries.filter(q=>q.sql.includes('FROM spaces s JOIN members m')).length,2,'room authorization is one indexed check at each read boundary');
    for(const section of sections){
      assert.equal(overview[section].length,20);assert.equal(overview.pages[section].complete,false);assert.ok(overview.pages[section].next_cursor);
      const allIds=new Set((section==='events'?f.db.sqlite.prepare('SELECT id FROM events WHERE space_id=?').all(f.space.id):whole[section]).map(row=>section==='people'?row.user_id:row.id));
      const received=overview[section].map(row=>row.id),plans=[];let cursor=overview.pages[section].next_cursor;
      do{
        const before=queries.length;
        const page=await f.a.agentTool('read_space_section',{space_id:f.space.id,agent_id:f.sender.id,section,limit:13,cursor});
        assert.ok(page.items.length<=13);received.push(...page.items.map(row=>row.id));cursor=page.next_cursor;
        const query=queries.slice(before).find(q=>q.sql.includes('ORDER BY')&&q.sql.includes('LIMIT ?'));
        plans.push(...f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.args).map(row=>row.detail));
      }while(cursor);
      assert.equal(new Set(received).size,received.length,section+' has no duplicate records');assert.deepEqual(new Set(received),allIds,section+' reaches every record');
      assert.ok(!plans.some(plan=>plan.includes('USE TEMP B-TREE FOR ORDER BY')),section+' must page through existing indexed order');
    }
    assert.ok(!JSON.stringify(overview).includes('s'.repeat(100)));assert.ok(!JSON.stringify(overview).includes('b'.repeat(100)));assert.ok(!JSON.stringify(overview).includes('i'.repeat(100)));
    const largestSourcePage=await f.a.agentTool('read_space_section',{space_id:f.space.id,agent_id:f.sender.id,section:'sources',limit:100});assert.equal(largestSourcePage.items.length,100);
    const profiles=await f.a.agentTool('list_my_agents',{});assert.equal(profiles.agents.length,20);assert.ok(profiles.next_cursor);
    const ids=profiles.agents.map(p=>p.id);let cursor=profiles.next_cursor;
    while(cursor){const p=await f.a.agentTool('list_my_agents',{cursor});ids.push(...p.agents.map(p=>p.id));cursor=p.next_cursor;}
    assert.equal(ids.length,126);assert.equal(new Set(ids).size,126);assert.ok(ids.includes(f.sender.id));
  }finally{f.db.sqlite.close();}
});

test('room page cursors are bound to owner, profile, room, section and membership generation',async()=>{
  const f=await populated();
  try{
    const first=await f.a.agentTool('read_space_section',{agent_id:f.sender.id,space_id:f.space.id,section:'sources',limit:2}),base={agent_id:f.sender.id,space_id:f.space.id,section:'sources',cursor:first.next_cursor};
    for(const args of [{...base,section:'tasks'},{...base,agent_id:'!agent-000'},{...base,limit:101},{...base,cursor:'malformed'}])await assert.rejects(f.a.agentTool('read_space_section',args),{status:400});
    const other=await f.a.human('create_space',{name:'Other',topic:'Test',purpose:'Different room'});await f.a.human('attach_agent',{space_id:other.id,agent_id:f.sender.id});
    await assert.rejects(f.a.agentTool('read_space_section',{...base,space_id:other.id}),{status:400});
    await assert.rejects(f.b.agentTool('read_space_section',{...base,agent_id:f.recipient.id}),{status:400});
    await assert.rejects(f.outsider.agentTool('read_space_section',base),{status:403});
    f.db.sqlite.prepare('UPDATE members SET membership_key=? WHERE space_id=? AND user_id=?').run('fresh-membership',f.space.id,f.a.user.id);
    await assert.rejects(f.a.agentTool('read_space_section',base),{status:400});
    const all=f.a.all.bind(f.a);let changed=false;
    f.a.all=async(sql,...args)=>{const rows=await all(sql,...args);if(!changed&&sql.includes('FROM sources src')){changed=true;f.db.sqlite.prepare('UPDATE spaces SET membership_version=membership_version+1 WHERE id=?').run(f.space.id);}return rows;};
    await assert.rejects(f.a.agentTool('read_space_section',{...base,cursor:undefined}),{status:409});
    f.a.all=all;
    f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.sender.id);
    await assert.rejects(f.a.agentTool('read_space',{agent_id:f.sender.id,space_id:f.space.id}),{status:403});
  }finally{f.db.sqlite.close();}
});

test('complete source reads never expose withdrawn management content and recheck source and access changes',async()=>{
  const f=await populated(),args={agent_id:f.sender.id,space_id:f.space.id,source_id:'source-000'};
  try{
    const read=await f.a.agentTool('read_shared_source',args);assert.ok(read.source.content.startsWith('Full source 000 '));assert.equal(read.source.version,0);
    await assert.rejects(f.b.agentTool('read_shared_source',args),{status:403});
    const other=await f.a.human('create_space',{name:'Other',topic:'Test',purpose:'Separate room'});await f.a.human('attach_agent',{space_id:other.id,agent_id:f.sender.id});
    await assert.rejects(f.a.agentTool('read_shared_source',{...args,space_id:other.id}),{status:403});
    const one=f.a.one.bind(f.a);let changed=false;
    f.a.one=async(sql,...values)=>{const row=await one(sql,...values);if(!changed&&sql.includes('src.title,src.content')){changed=true;f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id=?").run(args.source_id);}return row;};
    await assert.rejects(f.a.agentTool('read_shared_source',args),{status:409});f.a.one=one;
    await assert.rejects(f.a.agentTool('read_shared_source',args),{status:403});
    assert.ok((await f.a.readSource(args.source_id)).content.startsWith('Full source 000 '),'human management remains explicit and separate');
    const tombstones=await f.a.agentTool('read_space_section',{agent_id:f.sender.id,space_id:f.space.id,section:'sources',limit:100});
    assert.ok(!JSON.stringify(tombstones).includes('Full source 000 '));
    args.source_id='source-001';changed=false;
    f.a.one=async(sql,...values)=>{const row=await one(sql,...values);if(!changed&&sql.includes('src.title,src.content')){changed=true;f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.sender.id);}return row;};
    await assert.rejects(f.a.agentTool('read_shared_source',args),{status:403});
  }finally{f.db.sqlite.close();}
});

test('withdrawal at the final combined check hides source bodies and summary titles',async()=>{
  for(const tool of ['read_shared_source','read_space_section','read_space']){
    const f=await pair();
    try{
      const source=await f.a.human('add_source',{space_id:f.space.id,title:'Private after withdrawal',content:'Retained full source body',kind:'Note'}),all=f.a.all.bind(f.a);let changed=false;
      f.a.all=async(sql,...args)=>{if(!changed&&sql.includes('LEFT JOIN sources src ON src.space_id=s.id')){changed=true;f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id=?").run(source.id);}return all(sql,...args);};
      const args={agent_id:f.sender.id,space_id:f.space.id,...(tool==='read_shared_source'?{source_id:source.id}:tool==='read_space_section'?{section:'sources'}:{})};
      if(tool==='read_shared_source')await assert.rejects(f.a.agentTool(tool,args),{status:409});
      else{const result=await f.a.agentTool(tool,args);assert.ok(!JSON.stringify(result).includes('Private after withdrawal'));assert.ok(!JSON.stringify(result).includes('Retained full source body'));}
      assert.equal(changed,true);
    }finally{f.db.sqlite.close();}
  }
});

test('host uses bounded projections, checks authority outside previews and opens rooms beyond its catalog page',async()=>{
  const f=await populated();
  try{
    for(let i=0;i<25;i++){
      const s=await f.a.human('create_space',{name:'Recent room '+i,topic:'Other',purpose:'Synthetic catalog volume'});await f.a.human('attach_agent',{space_id:s.id,agent_id:f.sender.id});
      f.db.sqlite.prepare('UPDATE spaces SET created_at=? WHERE id=?').run(stamp(i),s.id);
    }
    f.a.readSpace=()=>{throw Error('Host must not hydrate the full human room.');};
    const host=new AccordHost(f.a);
    await host.perform('arrive_at_accord',{agent_id:f.sender.id,purpose:'Owner viewing a profile',service:'perspective'});
    assert.equal((await f.a.ownedAgent(f.sender.id)).status,'pending','human routing must not fabricate assistant contact');
    const arrival=await host.perform('arrive_at_accord',{agent_id:f.sender.id,purpose:'Review engineering',service:'perspective'},'agent');
    assert.equal(arrival.rooms.length,20);assert.equal(arrival.rooms_complete,false);assert.ok(arrival.rooms_next_cursor);assert.ok(!arrival.rooms.some(room=>room.id===f.space.id));
    const page=await f.a.agentTool('list_spaces',{agent_id:f.sender.id,cursor:arrival.rooms_next_cursor});assert.ok(page.spaces.some(room=>room.id===f.space.id));
    const entry=await host.perform('enter_room',{agent_id:f.sender.id,visit_id:arrival.visit.id,space_id:f.space.id},'agent');
    assert.equal(entry.room.id,f.space.id);assert.equal(entry.room.sources.length,6);assert.equal(entry.room.agents.length,20);assert.equal(entry.room.grants.length,6);
    assert.equal(entry.room.permissions.assign_work,true);assert.ok(!entry.room.grants.some(grant=>grant.assign),'real assignment permission comes from a grant outside the preview');
    assert.equal(entry.steps[1].tool,'read_space_section');assert.ok(entry.steps[1].detail.includes('grant pages'));
    assert.equal(entry.room.more.sources,true);assert.equal(entry.room.more.grants,true);assert.ok(!JSON.stringify(entry).includes('s'.repeat(100)));
    await f.b.human('revoke_authority',{grant_id:f.grant.id});
    const updated=await host.perform('consult_host',{agent_id:f.sender.id,visit_id:arrival.visit.id},'agent');assert.equal(updated.room.permissions.assign_work,false);
  }finally{f.db.sqlite.close();}
});
