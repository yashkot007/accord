import {pair} from './workspace.mjs';

export const stamp=i=>new Date(Date.UTC(2026,11,1,12,0,Math.floor(i/4))).toISOString();
export async function populated(){
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
