import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Workspace} from '../../lib/workspace.ts';

export function database({through}={}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')&&(!through||f<=through)).sort()) sqlite.exec(readFileSync(new URL('../../drizzle/' + migration, import.meta.url), 'utf8'));
  function statement(sql, values = []) {
    return {
      bind(...args) { return statement(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { const r = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
  }
  return { sqlite, prepare: statement, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}

export async function pair(db=database()) {
  const a=new Workspace(db,{id:'mentor',email:'mentor@example.test',name:'Mentor'}), b=new Workspace(db,{id:'recipient',email:'recipient@example.test',name:'Recipient'}), outsider=new Workspace(db,{id:'outsider',email:'outsider@example.test',name:'Outsider'});
  await a.bootstrap();await b.bootstrap();await outsider.bootstrap();
  const space=await a.human('create_space',{name:'Review',topic:'Engineering',purpose:'Better decisions'});
  const invitation=await a.human('invite_member',{space_id:space.id,email:b.user.email,role:'participant'});
  await b.human('join_space',{code:invitation.code});
  const sender=await a.human('add_agent',{name:'Mentor agent',provider:'Test'}), recipient=await b.human('add_agent',{name:'Recipient agent',provider:'Test'});
  await a.human('attach_agent',{space_id:space.id,agent_id:sender.id});await b.human('attach_agent',{space_id:space.id,agent_id:recipient.id});
  const grant=await b.human('grant_authority',{space_id:space.id,from_agent:sender.id,to_agent:recipient.id,allow_assign:true,allow_context:true,expires_at:new Date(Date.now()+86400000).toISOString()});
  return {db,a,b,outsider,space,sender,recipient,grant};
}
