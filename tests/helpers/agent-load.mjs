// Synthetic-only fixture for the local Miniflare workload. No production bindings.
import {Workspace} from '../../lib/workspace.ts';

export async function seedAgentLoad(db, rows) {
  const users = {
    sender: {id:'workload-sender', email:'sender@example.test', name:'Synthetic sender'},
    recipient: {id:'workload-recipient', email:'recipient@example.test', name:'Synthetic recipient'},
    outsider: {id:'workload-outsider', email:'outsider@example.test', name:'Synthetic outsider'},
  };
  const a = new Workspace(db, users.sender), b = new Workspace(db, users.recipient);
  await a.bootstrap(); await b.bootstrap(); await new Workspace(db,users.outsider).bootstrap();
  const space = await a.human('create_space',{name:'Synthetic workload room', topic:'Local measurements', purpose:'Isolated correctness and latency probe'});
  const invitation = await a.human('invite_member',{space_id:space.id,email:users.recipient.email,role:'participant'});
  await b.human('join_space',{code:invitation.code});
  const sender = await a.human('add_agent',{name:'Synthetic sender',provider:'Workload fixture'});
  const recipient = await b.human('add_agent',{name:'Synthetic recipient',provider:'Workload fixture'});
  await a.human('attach_agent',{space_id:space.id,agent_id:sender.id});
  await b.human('attach_agent',{space_id:space.id,agent_id:recipient.id});
  const expires = new Date(Date.now()+86400000).toISOString();
  const grant = await b.human('grant_authority',{space_id:space.id,from_agent:sender.id,to_agent:recipient.id,allow_assign:true,allow_context:true,expires_at:expires});
  let statements = [];
  const add = (sql,...values) => statements.push(db.prepare(sql).bind(...values));
  for (let i=0; i<rows; i++) {
    const suffix=String(i).padStart(6,'0'), date=new Date(Date.UTC(2025,0,1,0,0,Math.floor(i/4))).toISOString();
    const person='workload-person-'+suffix, profile='workload-agent-'+suffix;
    add('INSERT INTO people (id,email,name) VALUES (?,?,?)',person,person+'@example.test','Synthetic person');
    add('INSERT INTO members (space_id,user_id,role) VALUES (?,?,?)',space.id,person,'participant');
    add('INSERT INTO agents (id,owner_id,name,provider,status,created_at) VALUES (?,?,?,?,?,?)',profile,users.sender.id,'Synthetic profile','Workload fixture','connected',date);
    add('INSERT INTO space_agents (space_id,agent_id) VALUES (?,?)',space.id,profile);
    add('INSERT INTO sources (id,space_id,title,content,kind,created_by,created_at) VALUES (?,?,?,?,?,?,?)','workload-source-'+suffix,space.id,'Synthetic source '+suffix,'Synthetic source '+suffix+' '+'s'.repeat(19900),'Note',users.sender.id,date);
    add('INSERT INTO tasks (id,space_id,grant_id,from_agent,to_agent,title,body,status,feedback,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)','workload-task-'+suffix,space.id,grant.id,sender.id,recipient.id,'Synthetic task '+suffix,'b'.repeat(8000),i%2?'completed':'queued',i%2?'f'.repeat(8000):'','agent',date,date);
    add('INSERT INTO changes (id,space_id,grant_id,from_agent,to_agent,title,previous,instruction,reason,scope,status,adopted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)','workload-change-'+suffix,space.id,grant.id,sender.id,recipient.id,'Synthetic guidance '+suffix,'p'.repeat(5000),'i'.repeat(5000),'r'.repeat(3000),'Synthetic scope',i%2?'accepted':'pending',i%2?'a'.repeat(5000):null,date,date);
    add('INSERT INTO grants (id,space_id,from_agent,to_agent,scope,allow_assign,allow_context,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)','workload-grant-'+suffix,space.id,sender.id,recipient.id,'Synthetic scope',0,1,'active',expires,date);
    add('INSERT INTO events (id,space_id,actor_id,kind,description,created_at) VALUES (?,?,?,?,?,?)','workload-event-'+suffix,space.id,users.sender.id,'instruction','Synthetic event '+suffix,date);
    if (statements.length>=90) { await db.batch(statements); statements=[]; }
  }
  if (statements.length) await db.batch(statements);
  return {users,space_id:space.id,sender_id:sender.id,recipient_id:recipient.id,grant_id:grant.id,rows,queued:Math.ceil(rows/2),accepted:Math.floor(rows/2)};
}
