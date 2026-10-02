import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backup,DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,readdirSync,copyFileSync,rmSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {database,pair,wrapDatabase} from './helpers/workspace.mjs';
import {Workspace} from '../lib/workspace.ts';
import {AccordHost} from '../lib/host.ts';

const hash=data=>createHash('sha256').update(data).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function snapshot(sqlite){
  const schema=sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables=schema.filter(s=>s.type==='table').map(s=>s.name);
  const rows=Object.fromEntries(tables.map(name=>[name,sqlite.prepare(`SELECT * FROM ${quote(name)}`).all().map(row=>JSON.stringify(row)).sort()]));
  return {schema,rows};
}
function integrity(sqlite){
  assert.deepEqual(sqlite.prepare('PRAGMA integrity_check').all().map(r=>r.integrity_check),['ok']);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}
function temporary(t){
  const dir=mkdtempSync(join(tmpdir(),'accord-recovery-'));
  const connections=new Set();
  t.after(()=>{try{for(const db of connections)if(db.isOpen)db.close();}finally{rmSync(dir,{recursive:true,force:true});}});
  return {dir,track(db){connections.add(db);return db;}};
}
function record(t,backupPath,before,appliedThrough){
  const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sha256:hash(readFileSync(new URL('../drizzle/'+name,import.meta.url)))}));
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const recoveryInputs=['../lib/workspace.ts','../lib/host.ts','../db/schema.ts','./helpers/workspace.mjs','./backup-restore.test.mjs'].map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))]);
  let revision='unavailable',dirty=true;
  try{revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8',cwd}).trim();}catch{}
  t.diagnostic(JSON.stringify({kind:'isolated-synthetic-recovery',captured_at:new Date().toISOString(),revision,working_tree_dirty:dirty,node:process.version,recovery_inputs_sha256:hash(JSON.stringify(recoveryInputs)),backup_sha256:hash(readFileSync(backupPath)),schema_and_rows_sha256:hash(JSON.stringify(before)),table_counts:Object.fromEntries(Object.entries(before.rows).map(([name,rows])=>[name,rows.length])),applied_migrations:migrations.filter(m=>!appliedThrough||m.name<=appliedThrough),available_migrations:migrations,production_backup_verified:false}));
}
async function restored(t,db,appliedThrough){
  const temp=temporary(t);temp.track(db.sqlite);
  const backupPath=join(temp.dir,'snapshot.sqlite'),restoredPath=join(temp.dir,'restored.sqlite');
  const before=snapshot(db.sqlite);integrity(db.sqlite);
  await backup(db.sqlite,backupPath);
  db.sqlite.close();
  // The backup has its own consistent file; never copy a live database or its WAL.
  copyFileSync(backupPath,restoredPath,constants.COPYFILE_EXCL);
  const sqlite=temp.track(new DatabaseSync(restoredPath));
  integrity(sqlite);assert.deepEqual(snapshot(sqlite),before);
  record(t,backupPath,before,appliedThrough);
  return wrapDatabase(sqlite);
}
async function fixture(){
  const f=await pair();
  const sourceArgs={space_id:f.space.id,title:'Evidence to retain privately',content:'Synthetic operational background.',kind:'Note',request_id:'source-receipt'};
  const source=await f.a.human('add_source',sourceArgs);
  const task=await f.a.human('send_instruction',{grant_id:f.grant.id,title:'Trace a decision',body:'Name the evidence.',request_id:'task-receipt'});
  const reportArgs={task_id:task.id,expected_version:0,status:'working',feedback:'First evidence.',request_id:'progress-receipt'};
  const report=await f.b.human('report_progress',reportArgs);
  await f.b.human('report_progress',{...reportArgs,expected_version:1,status:'completed',feedback:'Boundary checked.',request_id:'progress-complete'});
  const change=await f.a.human('propose_context_change',{grant_id:f.grant.id,title:'Check evidence',instruction:'Check the evidence before selecting a tool.',reason:'Make the assumption visible.',source_id:source.id,request_id:'proposal-receipt'});
  const decisionArgs={change_id:change.id,expected_version:0,expected_source_version:0,decision:'accepted',instruction:'Check evidence first.',decision_note:'Fits this task.',request_id:'decision-receipt'};
  const decision=await f.b.human('decide_context',decisionArgs);
  await f.b.human('decide_context',{...decisionArgs,expected_version:1,decision:'pending',request_id:'decision-reconsider'});
  await f.b.human('decide_context',{...decisionArgs,expected_version:2,instruction:'State evidence and uncertainty before choosing.',request_id:'decision-adapt'});
  await f.a.human('set_source_state',{source_id:source.id,expected_version:0,status:'withdrawn'});
  const oldInvite=await f.a.human('invite_member',{space_id:f.space.id,email:f.b.user.email,role:'participant'});
  const preview=await f.a.readMembership({space_id:f.space.id,user_id:f.b.user.id});
  const removalArgs={space_id:f.space.id,user_id:f.b.user.id,expected_membership_key:preview.member.membership_key,expected_space_version:preview.space.membership_version,request_id:'removal-receipt'};
  const removal=await f.a.human('remove_member',removalArgs);
  const freshInvite=await f.a.human('invite_member',{space_id:f.space.id,email:f.b.user.email,role:'participant'});
  await f.b.human('join_space',{code:freshInvite.code});
  await f.b.human('attach_agent',{space_id:f.space.id,agent_id:f.recipient.id});
  const grantArgs={space_id:f.space.id,from_agent:f.sender.id,to_agent:f.recipient.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString(),request_id:'replacement-grant'};
  const grant=await f.b.human('grant_authority',grantArgs);
  const privateAgent=await f.b.human('add_agent',{name:'Other private profile',provider:'Synthetic',request_id:'private-profile'});
  const host=new AccordHost(f.b);
  const closed=await host.perform('arrive_at_accord',{purpose:'Private closed purpose.',service:'perspective',agent_id:f.recipient.id,request_id:'closed-session'});
  await host.perform('enter_room',{visit_id:closed.visit.id,space_id:f.space.id});
  await host.perform('leave_accord',{visit_id:closed.visit.id,outcome:'Private reported outcome.'});
  const open=await host.perform('arrive_at_accord',{purpose:'Private open purpose.',service:'continuity',agent_id:privateAgent.id,request_id:'open-session'});
  // Credential key material is external to the database; these are synthetic opaque fixtures only.
  f.db.sqlite.prepare("INSERT INTO provider_connections (owner_id,provider,connection_id,credential,status,updated_at) VALUES (?,'granola','synthetic-connection','synthetic-encrypted-credential','connected',?)").run(f.b.user.id,new Date().toISOString());
  f.db.sqlite.prepare("INSERT INTO provider_oauth_flows (state_hash,owner_id,provider,details,status,created_at,expires_at) VALUES ('synthetic-state',?,'granola',NULL,'completed',?,?)").run(f.b.user.id,new Date().toISOString(),new Date().toISOString());
  f.db.sqlite.prepare("INSERT INTO provider_import_drafts (id,owner_id,connection_id,content,created_at,expires_at) VALUES ('synthetic-draft',?,'synthetic-connection','synthetic-encrypted-draft',?,?)").run(f.b.user.id,new Date().toISOString(),new Date().toISOString());
  return {...f,source,sourceArgs,task,reportArgs,report,change,decisionArgs,decision,oldInvite,removalArgs,removal,grantArgs,replacement:grant,privateAgent,closed,open};
}

test('whole-database recovery preserves every table, authority, history, private sessions and retry receipts',async t=>{
  const f=await fixture();
  const before=snapshot(f.db.sqlite);
  assert.equal(Object.keys(before.rows).length,19);
  assert.ok(Object.values(before.rows).every(rows=>rows.length>0),'Every application table has representative records');
  const db=await restored(t,f.db);
  const a=new Workspace(db,f.a.user),b=new Workspace(db,f.b.user),outsider=new Workspace(db,f.outsider.user);
  const host=new AccordHost(b);
  const history=await b.readTask({task_id:f.task.id});
  assert.deepEqual(history.updates.map(u=>u.version),[1,2]);assert.equal(history.task.status,'completed');
  const guidance=await b.readGuidance({change_id:f.change.id});
  assert.deepEqual(guidance.history.map(d=>d.version),[1,2,3]);assert.equal(guidance.current.adopted,'State evidence and uncertainty before choosing.');
  const shared=await a.readSpace(f.space.id);assert.ok(!JSON.stringify(shared).includes(f.sourceArgs.content));assert.ok(!JSON.stringify(shared).includes(f.sourceArgs.title));
  await assert.rejects(outsider.readSpace(f.space.id),{status:403});
  await assert.rejects(new AccordHost(a).perform('consult_host',{visit_id:f.open.visit.id}),{status:403});
  await assert.rejects(host.visit(f.open.visit.id,f.recipient.id),{status:403});
  assert.equal((await host.perform('consult_host',{visit_id:f.closed.visit.id})).receipt.outcome,'Private reported outcome.');
  const exactBefore=snapshot(db.sqlite);
  assert.equal((await a.human('add_source',f.sourceArgs)).id,f.source.id);
  assert.deepEqual(await b.human('report_progress',f.reportArgs),f.report);
  assert.deepEqual(await b.human('decide_context',f.decisionArgs),f.decision);
  assert.equal((await a.human('remove_member',f.removalArgs)).id,f.removal.id);
  assert.equal((await b.human('grant_authority',f.grantArgs)).id,f.replacement.id);
  await assert.rejects(b.human('join_space',{code:f.oldInvite.code}));
  await assert.rejects(b.human('decide_context',{...f.decisionArgs,instruction:'Changed retry'}),{status:409});
  assert.deepEqual(snapshot(db.sqlite),exactBefore,'Recovery must not repeat effects or restore withdrawn content');
  const context=await b.agentTool('read_context',{agent_id:f.recipient.id});
  assert.equal(context.context.length,1);assert.equal(context.context[0].instruction,'State evidence and uncertainty before choosing.');
  assert.equal(context.context[0].source_status,'withdrawn');
  assert.deepEqual((await host.agentSessions({agent_id:f.privateAgent.id})).sessions.map(v=>v.id),[f.open.visit.id]);
  const grants=db.sqlite.prepare('SELECT id,status FROM grants').all();
  assert.equal(grants.find(g=>g.id===f.grant.id).status,'revoked');assert.equal(grants.find(g=>g.id===f.replacement.id).status,'active');
  integrity(db.sqlite);
});

test('an older-schema backup restores before applying only the remaining migration',async t=>{
  const db=database({through:'0007_tiny_sabra.sql'});
  db.sqlite.exec("INSERT INTO people VALUES ('legacy','legacy@example.test','Legacy'); INSERT INTO spaces VALUES ('legacy-space','legacy','Earlier work','Keep the evidence','Engineering','2026-01-01'); INSERT INTO members VALUES ('legacy-space','legacy','owner')");
  const restoredDb=await restored(t,db,'0007_tiny_sabra.sql'),sqlite=restoredDb.sqlite;
  const before=snapshot(sqlite),migration=readFileSync(new URL('../drizzle/0008_complex_spencer_smythe.sql',import.meta.url),'utf8');
  sqlite.exec('BEGIN');
  try{sqlite.exec(migration);sqlite.exec("UPDATE spaces SET name='Partial change'; INSERT INTO deliberately_missing_table VALUES (1)");assert.fail('Injected failure must stop the migration');}
  catch(error){sqlite.exec('ROLLBACK');assert.match(error.message,/deliberately_missing_table/);}
  assert.deepEqual(snapshot(sqlite),before,'Failed local migration is fully rolled back');
  sqlite.exec('BEGIN');sqlite.exec(migration);sqlite.exec('COMMIT');
  const member=sqlite.prepare('SELECT * FROM members').get();assert.equal(member.membership_key,'legacy');assert.equal(member.role,'owner');
  assert.equal(sqlite.prepare('SELECT * FROM spaces').get().name,'Earlier work');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM membership_changes').get().n,0);
  assert.throws(()=>sqlite.exec(migration),/already exists/);
  integrity(sqlite);
});

test('an old snapshot can revive later-revoked access and must stay isolated until access is reconciled',async t=>{
  const temp=temporary(t),f=await pair(),path=join(temp.dir,'before-removal.sqlite');
  temp.track(f.db.sqlite);
  await backup(f.db.sqlite,path);
  const p=await f.a.readMembership({space_id:f.space.id,user_id:f.b.user.id});
  await f.a.human('remove_member',{space_id:f.space.id,user_id:f.b.user.id,expected_membership_key:p.member.membership_key,expected_space_version:p.space.membership_version,request_id:'after-backup'});
  await assert.rejects(f.b.readSpace(f.space.id),{status:403});
  const old=temp.track(new DatabaseSync(path,{readOnly:true}));
  const oldRecipient=new Workspace(wrapDatabase(old),f.b.user);
  assert.equal((await oldRecipient.readSpace(f.space.id)).id,f.space.id);
  assert.equal(old.prepare('SELECT status FROM grants WHERE id=?').get(f.grant.id).status,'active');
  t.diagnostic('Expected recovery hazard reproduced: post-capture membership removal and grant revocation are absent from an older snapshot. No production restore or reconciliation was attempted.');
});
