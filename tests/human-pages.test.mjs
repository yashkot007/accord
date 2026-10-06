import {test} from 'node:test';
import assert from 'node:assert/strict';
import {populated} from './helpers/large-room.mjs';
import {pair,database} from './helpers/workspace.mjs';
import {collectHumanContext} from '../lib/human-context.ts';
import {readFileSync} from 'node:fs';

const sections=['people','agents','grants','sources','tasks','changes','events'];
function reader(workspace){return async path=>{
  const p=new URL(path,'https://accord.example').searchParams,space=p.get('space');
  if(p.has('check_export'))return workspace.checkHumanExport(space,{revision:Number(p.get('revision')),membership_key:p.get('membership_key'),membership_version:Number(p.get('membership_version'))});
  return workspace.humanRoomPage(space,p.get('section'),{cursor:p.get('cursor')||undefined,...(p.has('revision')?{revision:Number(p.get('revision'))}:{})});
};}
async function traverse(read,first){const rows=[...first.items];let cursor=first.next_cursor;while(cursor){const page=await read(cursor);rows.push(...page.items);cursor=page.next_cursor;}assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);return rows;}

test('human rooms load compact previews, exact names and real controls independently of truncated metadata',async()=>{
  const f=await populated();try{
    const full=await f.b.readSpace(f.space.id),queries=[],all=f.b.all.bind(f.b);
    f.b.all=async(sql,...args)=>{assert.ok(args.length<=100);queries.push({sql,args});return all(sql,...args);};
    const room=await f.b.humanRoom(f.space.id);
    assert.ok(JSON.stringify(room).length<JSON.stringify(full).length/30);
    assert.equal(room.counts.people,127);assert.equal(room.counts.active_agents,127);assert.equal(room.counts.my_agents,1);
    assert.ok(!room.agents.some(a=>a.id===f.recipient.id));assert.ok(!room.grants.some(g=>g.id===f.grant.id));
    assert.ok(room.tasks.every(t=>t.recipient_owned===1&&t.authority_active===1&&t.to_name==='Recipient agent'&&t.from_name==='Mentor agent'));
    assert.ok(room.changes.every(c=>c.recipient_owned===1&&c.to_name==='Recipient agent'));
    for(const section of sections){
      assert.equal(room[section].length,20);assert.ok(room.pages[section].next_cursor);
      const received=await traverse(cursor=>f.b.humanRoomPage(f.space.id,section,{cursor,limit:17}),{items:room[section],next_cursor:room.pages[section].next_cursor});
      const expected=section==='events'?f.db.sqlite.prepare('SELECT id FROM events WHERE space_id=?').all(f.space.id):full[section];
      assert.deepEqual(new Set(received.map(r=>r.id)),new Set(expected.map(r=>section==='people'?r.user_id:r.id)));
      if(['sources','tasks','changes','grants'].includes(section)){
        const query=queries.find(q=>q.sql.includes(`FROM ${section==='changes'?'changes c':section==='tasks'?'tasks t':section==='sources'?'sources src':'grants g'}`)&&q.sql.includes('ORDER BY')&&q.sql.includes('LIMIT ?'));
        assert.ok(!f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.args).some(p=>p.detail.includes('USE TEMP B-TREE FOR ORDER BY')));
      }
    }
    assert.ok(!JSON.stringify(room).includes('s'.repeat(500)));assert.ok(!JSON.stringify(room).includes('b'.repeat(500)));assert.ok(!JSON.stringify(room).includes('i'.repeat(500)));
    const exact=await f.b.readTask({task_id:room.tasks[0].id});assert.equal(exact.task.body.length,8000);
    const sending=await f.a.humanRoom(f.space.id);assert.equal(sending.counts.can_assign,1,'valid grant beyond the preview still enables assignment');
  }finally{f.db.sqlite.close();}
});

test('account catalogs and every selector reach older rooms, profiles, permissions and sources',async()=>{
  const f=await populated();try{
    for(let i=0;i<25;i++)await f.a.human('create_space',{name:'Room '+i,topic:'Test',purpose:'Synthetic volume'});
    const bootstrap=await f.a.humanBootstrap();assert.equal(bootstrap.spaces.length,20);assert.equal(bootstrap.agents.length,20);assert.equal(bootstrap.counts.spaces,26);assert.equal(bootstrap.counts.agents,126);
    for(const section of ['spaces','agents','events']){
      const first=await f.a.humanCatalog(section,section==='agents'?{active:'yes'}:{});
      const rows=await traverse(cursor=>f.a.humanCatalog(section,{cursor,...(section==='agents'?{active:'yes'}:{})}),first);
      if(section!=='events')assert.equal(rows.length,section==='spaces'?26:126);
    }
    for(const [kind,args,expected] of [['spaces',{},26],['agents',{},126],['agents',{space_id:f.space.id},127],['agents',{space_id:f.space.id,owned:'yes'},126],['grants',{space_id:f.space.id,capability:'assign'},1],['sources',{space_id:f.space.id},125]]){
      const rows=await traverse(cursor=>f.a.humanChoices(kind,{...args,cursor}),await f.a.humanChoices(kind,args));assert.equal(rows.length,expected);
      if(kind==='agents'&&args.owned==='yes')assert.ok(rows.every(p=>p.owner_id===f.a.user.id));
      if(kind==='grants')assert.equal(rows[0].id,f.grant.id);
    }
    const setup=await f.a.humanSetup(f.space.id);assert.equal(setup.has_profiles,true);assert.equal(setup.room.id,f.space.id);
    const profile=await f.a.humanProfile(f.sender.id,f.space.id);assert.equal(profile.attached,true);assert.equal(profile.profile.status,'pending');
    assert.ok(!bootstrap.agents.some(profile=>profile.id===f.sender.id),'selected profile is beyond the first catalog page');
    await assert.rejects(f.b.humanProfile(f.sender.id,f.space.id),{status:403});
    await assert.rejects(f.outsider.humanChoices('agents',{space_id:f.space.id}),{status:403});
    f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.sender.id);
    await assert.rejects(f.a.humanProfile(f.sender.id,f.space.id),{status:403});
  }finally{f.db.sqlite.close();}
});

test('whole-room export preserves every accepted record, exact wording, other recipients and withdrawn provenance',async()=>{
  const f=await populated();try{
    f.db.sqlite.prepare("UPDATE changes SET to_agent=? WHERE id='change-001'").run(f.sender.id);
    f.db.sqlite.prepare("UPDATE agents SET status='revoked' WHERE id=?").run(f.recipient.id);
    f.db.sqlite.prepare("UPDATE changes SET source_id='source-000' WHERE id='change-001'").run();
    f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id='source-000'").run();
    let pages=0;const read=reader(f.a),result=await collectHumanContext(f.space.id,async path=>{pages++;return read(path);});
    assert.equal(result.count,62);assert.equal(pages,5,'four complete pages and the final revision/access check');
    for(let i=1;i<125;i+=2)assert.ok(result.markdown.includes('Adopted '+String(i).padStart(3,'0')));
    assert.ok(result.markdown.includes('Recipient: Mentor agent'));assert.ok(result.markdown.includes('Recipient: Recipient agent'));
    assert.ok(result.markdown.includes('Reason: '+'r'.repeat(3000)));assert.ok(result.markdown.includes('Source: Source withdrawn'));
    assert.ok(!result.markdown.includes('Full source 000'));assert.ok(!result.markdown.includes('Synthetic source 000'));
  }finally{f.db.sqlite.close();}
});

test('export does not return a partial artifact on page failure, guidance/source updates or access changes',async()=>{
  for(const mode of ['network','guidance','source','membership','final']){
    const f=await populated();try{
      const read=reader(f.a);let calls=0;
      await assert.rejects(collectHumanContext(f.space.id,async path=>{
        calls++;
        if(calls===2&&mode==='network')throw new Error('Synthetic interrupted page');
        if(calls===2&&mode==='guidance')f.db.sqlite.prepare("UPDATE changes SET adopted='New version',version=version+1 WHERE id='change-123'").run();
        if(calls===2&&mode==='source')f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id='source-000'").run();
        if(calls===2&&mode==='membership')f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id,f.a.user.id);
        if(path.includes('check_export')&&mode==='final')f.db.sqlite.prepare("UPDATE changes SET status='pending',version=version+1 WHERE id='change-001'").run();
        return read(path);
      }));assert.ok(calls>=2);
    }finally{f.db.sqlite.close();}
  }
});

test('human cursors reject other owners, rooms, sections, filters and changed membership generations',async()=>{
  const f=await populated();try{
    const first=await f.a.humanRoomPage(f.space.id,'changes',{limit:1,status:'accepted'});
    await assert.rejects(f.a.humanRoomPage(f.space.id,'changes',{cursor:first.next_cursor,status:'pending'}),{status:400});
    await assert.rejects(f.a.humanRoomPage(f.space.id,'tasks',{cursor:first.next_cursor}),{status:400});
    await assert.rejects(f.b.humanRoomPage(f.space.id,'changes',{cursor:first.next_cursor,status:'accepted'}),{status:400});
    const profilePage=await f.a.humanCatalog('agents',{active:'yes',limit:1});
    await assert.rejects(f.a.humanCatalog('agents',{active:'no',cursor:profilePage.next_cursor}),{status:400});
    await assert.rejects(f.b.humanCatalog('agents',{active:'yes',cursor:profilePage.next_cursor}),{status:400});
    f.db.sqlite.prepare('UPDATE members SET membership_key=? WHERE space_id=? AND user_id=?').run('new-generation',f.space.id,f.a.user.id);
    await assert.rejects(f.a.humanRoomPage(f.space.id,'changes',{cursor:first.next_cursor,status:'accepted'}),{status:400});
    await assert.rejects(f.a.humanRoomPage(f.space.id,'constructor'),{status:400});
  }finally{f.db.sqlite.close();}
});

test('final source validation keeps human title, status and version coherent after withdrawal',async()=>{
  for(const route of ['overview','guidance','choices']){
    const f=await pair();try{
      const source=await f.a.human('add_source',{space_id:f.space.id,title:'Withdrawn private title',content:'Retained source body',kind:'Note'});
      await f.a.human('propose_context_change',{grant_id:f.grant.id,title:'Guidance',instruction:'A separate proposal',reason:'Review',source_id:source.id});
      const all=f.a.all.bind(f.a);let changed=false;
      f.a.all=async(sql,...args)=>{if(!changed&&sql.includes('LEFT JOIN sources src ON src.id=requested.value')){changed=true;f.db.sqlite.prepare("UPDATE sources SET status='withdrawn',version=version+1 WHERE id=?").run(source.id);}return all(sql,...args);};
      const result=route==='overview'?await f.a.humanRoom(f.space.id):route==='guidance'?await f.a.humanRoomPage(f.space.id,'changes'):await f.a.humanChoices('sources',{space_id:f.space.id});
      assert.equal(changed,true);assert.ok(!JSON.stringify(result).includes('Withdrawn private title'));assert.ok(!JSON.stringify(result).includes('Retained source body'));
      if(route!=='choices'){const change=(result.changes||result.items)[0];assert.equal(change.source_status,'withdrawn');assert.equal(change.source_version,1);}
      else assert.equal(result.items.length,0);
    }finally{f.db.sqlite.close();}
  }
});

test('context revision migration preserves history and versions every source/guidance mutation',async()=>{
  const db=database({through:'0012'});try{
    const f=await pair(db);const source=await f.a.human('add_source',{space_id:f.space.id,title:'Older source',content:'Preserved',kind:'Note'});
    db.sqlite.exec(readFileSync(new URL('../drizzle/0013_human_room_reads.sql',import.meta.url),'utf8'));
    assert.equal((await f.a.member(f.space.id)).context_revision,0);
    assert.equal((await f.a.readSource(source.id)).content,'Preserved');
    await f.a.human('set_source_state',{source_id:source.id,status:'withdrawn',expected_version:0});assert.equal((await f.a.member(f.space.id)).context_revision,1);
    const change=await f.a.human('propose_context_change',{grant_id:f.grant.id,title:'New guidance',instruction:'Carry the reasoning',reason:'Review'});assert.equal((await f.a.member(f.space.id)).context_revision,2);
    await f.b.human('decide_context',{change_id:change.id,decision:'accepted',expected_version:0,instruction:'Carry the reasoning'});assert.equal((await f.a.member(f.space.id)).context_revision,3);
  }finally{db.sqlite.close();}
});
