import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,pair} from './helpers/workspace.mjs';
import {AccordHost} from '../lib/host.ts';

const migration=readFileSync(new URL('../drizzle/0011_agent_page_indexes.sql',import.meta.url),'utf8');
const stamp=i=>new Date(Date.UTC(2026,9,1,12,0,Math.floor(i/4))).toISOString();
const indexedQueries=new Map([
  ['FROM tasks t JOIN grants','tasks_actionable_page'],
  ['FROM changes c LEFT JOIN sources','changes_accepted_page'],
  ['FROM host_visits v JOIN agents','host_visits_agent_page'],
]);

async function fixture(){
  const db=database({through:'0010_jittery_grey_gargoyle.sql'});
  // Keep the pre-index baseline while supplying the current contact column.
  db.sqlite.exec(readFileSync(new URL('../drizzle/0014_agent_contact.sql',import.meta.url),'utf8'));
  const f=await pair(db);
  const sibling=await f.b.human('add_agent',{name:'Other owned profile',provider:'Synthetic review'});
  await f.b.human('attach_agent',{space_id:f.space.id,agent_id:sibling.id});
  const siblingGrant=await f.b.human('grant_authority',{space_id:f.space.id,from_agent:f.sender.id,to_agent:sibling.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
  const reverseGrant=await f.a.human('grant_authority',{space_id:f.space.id,from_agent:f.recipient.id,to_agent:f.sender.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
  const task=f.db.sqlite.prepare('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,version,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const change=f.db.sqlite.prepare('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,adopted,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const visit=f.db.sqlite.prepare('INSERT INTO host_visits (id,owner_id,agent_id,purpose,service,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const expected={inbox:[],context:[],sessions:[]};
  for(const [prefix,profile,grant,sender,owner] of [
    ['target',f.recipient.id,f.grant.id,f.sender.id,f.b.user.id],
    ['sibling',sibling.id,siblingGrant.id,f.sender.id,f.b.user.id],
    ['other-owner',f.sender.id,reverseGrant.id,f.recipient.id,f.a.user.id],
  ]){
    for(let i=0;i<64;i++){
      const suffix=String(i).padStart(3,'0'),date=stamp(i);
      const taskId=`task-${prefix}-${suffix}`,taskStatus=['queued','working','needs_input','completed','declined'][i%5];
      task.run(taskId,f.space.id,grant,sender,profile,'Synthetic task','Synthetic body',taskStatus,'',0,'agent',date,date);
      const changeId=`change-${prefix}-${suffix}`,changeStatus=['accepted','pending','declined'][i%3];
      change.run(changeId,f.space.id,grant,sender,profile,'Synthetic guidance','','Proposed wording','Synthetic reason','Synthetic scope',changeStatus,changeStatus==='accepted'?'Adopted wording':null,1,date,date);
      const visitId=`visit-${prefix}-${suffix}`,visitStatus=['arrived','inside','departed'][i%3];
      visit.run(visitId,owner,profile,'Synthetic purpose','perspective',visitStatus,date,date);
      if(prefix==='target'){
        if(['queued','working','needs_input'].includes(taskStatus))expected.inbox.push({id:taskId,status:taskStatus});
        if(changeStatus==='accepted')expected.context.push({id:changeId});
        expected.sessions.push({id:visitId,status:visitStatus});
      }
    }
  }
  return {...f,expected,sibling};
}

async function traverse(f,kind,status){
  let cursor;const pages=[],plans=[];
  const all=f.b.all.bind(f.b);
  f.b.all=async(sql,...args)=>{
    const match=[...indexedQueries].find(([part])=>sql.includes(part));
    if(match)plans.push({index:match[1],details:f.db.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail)});
    return all(sql,...args);
  };
  try{
    do{
      const args={agent_id:f.recipient.id,limit:7,...(cursor?{cursor}:{}),...(status?{status}:{})};
      const page=kind==='sessions'?await new AccordHost(f.b).agentSessions(args):await f.b.agentTool(kind==='inbox'?'read_inbox':'read_context',args);
      const rows=page[kind==='inbox'?'instructions':kind==='context'?'context':'sessions'];
      assert.ok(rows.length<=7);
      pages.push(page);cursor=page.next_cursor;
    }while(cursor);
  }finally{f.b.all=all;}
  return {pages,plans};
}

const cases=[['inbox'],['inbox','queued'],['inbox','working'],['inbox','needs_input'],['context'],['sessions'],['sessions','open'],['sessions','closed']];

test('pagination indexes preserve actual filtered agent results and eliminate temporary ordering sorts',async()=>{
  const f=await fixture();
  try{
    const before=[];
    for(const [kind,status] of cases){
      const result=await traverse(f,kind,status);
      const key=kind==='inbox'?'instructions':kind==='context'?'context':'sessions';
      const rows=result.pages.flatMap(page=>page[key]),ids=rows.map(row=>row.id);
      const expected=f.expected[kind].filter(row=>!status||(kind==='sessions'?(status==='closed'?row.status==='departed':row.status!=='departed'):row.status===status)).map(row=>row.id);
      assert.deepEqual(ids,expected,`${kind}/${status??'all'} must keep stable order, reach every page and exclude other profiles`);
      assert.equal(new Set(ids).size,ids.length);
      before.push(result);
    }
    const installed=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>row.name);
    const absent=[...indexedQueries.values()].every(name=>!installed.includes(name));
    if(absent){
      assert.ok(before.every(result=>result.plans.some(plan=>plan.details.some(detail=>detail.includes('USE TEMP B-TREE FOR ORDER BY')))),'baseline plans must demonstrate the removed sorting work');
      f.db.sqlite.exec(migration);
    }else{
      assert.ok([...indexedQueries.values()].every(name=>installed.includes(name)),'either all candidate indexes or none must be installed');
    }
    for(let i=0;i<cases.length;i++){
      const [kind,status]=cases[i],after=await traverse(f,kind,status);
      assert.deepEqual(after.pages,before[i].pages,`${kind}/${status??'all'} query results must remain unchanged`);
      assert.ok(after.plans.length>=2,'the fixture must exercise continuation queries');
      for(const plan of after.plans){
        assert.ok(plan.details.some(detail=>detail.includes(plan.index)),`${kind}/${status??'all'} must use ${plan.index}`);
        assert.ok(!plan.details.some(detail=>detail.includes('USE TEMP B-TREE FOR ORDER BY')),`${kind}/${status??'all'} must not sort a temporary B-tree`);
      }
    }
    await assert.rejects(f.a.agentTool('read_inbox',{agent_id:f.recipient.id}),{status:403});
    await assert.rejects(new AccordHost(f.a).agentSessions({agent_id:f.recipient.id}),{status:403});
    await assert.rejects(f.outsider.agentTool('read_context',{agent_id:f.recipient.id}),{status:403});
    await f.b.human('revoke_authority',{grant_id:f.grant.id});
    assert.deepEqual((await f.b.agentTool('read_inbox',{agent_id:f.recipient.id})).instructions,[]);
  }finally{f.db.sqlite.close();}
});
