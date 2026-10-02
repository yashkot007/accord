import { AppError, field, Workspace, type Args } from './workspace.ts';

export const hostServices = [
  { id: 'perspective', name: 'Seek a perspective', description: 'Bring a question to a relationship you trust.', keywords: ['perspective', 'mentor', 'review', 'advice', 'decision', 'design', 'guidance'] },
  { id: 'learn', name: 'Learn together', description: 'Continue a lesson, or work through something new.', keywords: ['learn', 'lesson', 'teach', 'student', 'study', 'practice', 'class'] },
  { id: 'orientation', name: 'Find your bearings', description: 'Gather the context you need to get started.', keywords: ['onboard', 'start', 'new', 'understand', 'orientation', 'join', 'engineer'] },
  { id: 'continuity', name: 'Carry things forward', description: 'Return to a relationship with progress and context.', keywords: ['continue', 'progress', 'context', 'feedback', 'return', 'follow', 'next'] },
] as const;
const timestamp = () => new Date().toISOString();
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const stopWords = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'for', 'want', 'need', 'help', 'have', 'what', 'your', 'would', 'about', 'some', 'into', 'our']);

/** A transparent, permission-aware routing host. No model or hidden execution. */
export class AccordHost {
  workspace: Workspace;
  constructor(workspace: Workspace) { this.workspace = workspace; }
  async visitor(agentId: string) { return agentId ? this.workspace.ownedAgent(agentId) : null; }
  async visit(visitId: string, agentId?: string) {
    const v = await this.workspace.one('SELECT * FROM host_visits WHERE id=? AND owner_id=?', visitId, this.workspace.user.id);
    if (!v || (agentId !== undefined && v.agent_id !== agentId)) throw new AppError('This session is not available to this participant.', 403);
    if (v.agent_id && (agentId !== undefined || v.status !== 'departed')) await this.visitor(v.agent_id);
    return v;
  }
  async rooms(agentId: string) {
    if (agentId) {
      await this.visitor(agentId);
      return this.workspace.all('SELECT s.*,m.role FROM spaces s JOIN members m ON m.space_id=s.id JOIN space_agents sa ON sa.space_id=s.id WHERE m.user_id=? AND sa.agent_id=? ORDER BY s.created_at DESC', this.workspace.user.id, agentId);
    }
    return this.workspace.all('SELECT s.*,m.role FROM spaces s JOIN members m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at DESC', this.workspace.user.id);
  }
  async arrivals() {
    return { visits: await this.workspace.all('SELECT v.*,a.name AS agent_name,s.name AS room_name FROM host_visits v LEFT JOIN agents a ON a.id=v.agent_id LEFT JOIN spaces s ON s.id=v.room_id WHERE v.owner_id=? ORDER BY v.updated_at DESC LIMIT 30', this.workspace.user.id), mode: 'guided', services: hostServices.map(({keywords, ...s}) => s) };
  }
  async guide(v: Record<string, any>) {
    if (v.status === 'departed') return { visit:v, visitor:{name:'Participant'}, mode:'guided', host:{name:'Accord',service:hostServices.find(s=>s.id===v.service)?.name,message:'This session is closed. The summary records what was reported. Closing a session does not close its relationship or shared space.'},rooms:[],recommended_room_id:null,room:null,steps:[],boundaries:[],receipt:{outcome:v.outcome,recorded_at:v.updated_at,source:'Reported by the participant; not independently verified'} };
    const agent = await this.visitor(v.agent_id || ''), rooms = await this.rooms(v.agent_id || '');
    const requested = words(v.purpose); for (const word of stopWords) requested.delete(word);
    const ranked = rooms.map(room => {
      const terms = words(`${room.name} ${room.topic} ${room.purpose}`);
      const matched = [...requested].filter(word => terms.has(word));
      return { id: room.id, name: room.name, topic: room.topic, purpose: room.purpose, matched, score: matched.length };
    }).sort((a, b) => b.score - a.score);
    const recommendation = ranked[0]?.score > 0 ? ranked[0] : null;
    const service = hostServices.find(s => s.id === v.service)!;
    let message = !ranked.length
      ? 'There isn’t an accessible space for this participant yet. Create a space or join through an existing invitation, then continue this session.'
      : recommendation
        ? `“${recommendation.name}” is a useful starting point: its purpose shares ${recommendation.matched.slice(0, 3).map(w => `“${w}”`).join(', ')} with this session’s purpose. Choose a space to see what is available there.`
        : 'Your accessible spaces are here. I haven’t found a clear purpose match, so choose a space for this session. A shared topic alone never grants access.';
    let room = null;
    if (v.room_id && rooms.some(r=>r.id===v.room_id)) {
      if (v.agent_id) await this.workspace.agentAccess(v.room_id, v.agent_id);
      const s: Awaited<ReturnType<Workspace['readSpace']>> & Record<string, any> = await this.workspace.readSpace(v.room_id);
      const active = s.grants.filter(g => g.status === 'active' && g.expires_at > timestamp() && s.agents.some(a => a.id === g.from_agent && a.status !== 'revoked') && s.agents.some(a => a.id === g.to_agent && a.status !== 'revoked'));
      const ownIds = v.agent_id ? [v.agent_id] : s.agents.filter(a => a.owner_id === this.workspace.user.id && a.status !== 'revoked').map(a => a.id);
      const outgoing = active.filter(g => ownIds.includes(g.from_agent));
      const inbox = s.tasks.filter(t => ownIds.includes(t.to_agent) && ['queued','working','needs_input'].includes(t.status) && active.some(g => g.id === t.grant_id && g.allow_assign));
      const reviews = s.changes.filter(c => ownIds.includes(c.to_agent) && c.status === 'pending');
      const context = s.changes.filter(c => ownIds.includes(c.to_agent) && c.status === 'accepted');
      room = {
        id:s.id, name:s.name, purpose:s.purpose, topic:s.topic,
        sources:s.sources.map(x => ({id:x.id,title:x.title,kind:x.kind})),
        agents:s.agents.map(a => ({id:a.id,name:a.name,status:a.status})),
        permissions:{read_shared_context:true,assign_work:outgoing.some(g => g.allow_assign),propose_context:outgoing.some(g => g.allow_context),accept_context:false},
        grants:outgoing.map(g => ({id:g.id,to_agent:g.to_agent,scope:g.scope,assign:!!g.allow_assign,propose:!!g.allow_context,expires_at:g.expires_at})),
        inbox:inbox.map(t=>({id:t.id,title:t.title,status:t.status})),
        reviews:reviews.map(c=>({id:c.id,title:c.title})),
        context:context.map(c=>({id:c.id,title:c.title,instruction:c.adopted,scope:c.scope,reason:c.reason})),
      };
      message = `You’re in “${s.name}”. ${s.sources.length ? `${s.sources.length} shared ${s.sources.length === 1 ? 'source is' : 'sources are'} available for this session.` : 'Start by sharing the background this relationship needs.'} ${inbox.length ? `${inbox.length} ${inbox.length === 1 ? 'instruction awaits' : 'instructions await'} this participant.` : 'No open instructions are assigned to this participant.'}`;
    }
    const preparation: Record<string, {title:string;detail:string}> = {
      perspective:{title:'Frame the decision',detail:'Use the shared background to name the decision, your current assumption, and the perspective you are seeking.'},
      learn:{title:'Start from what is understood',detail:'Use the shared lesson material to identify one question or skill to work through with this relationship.'},
      orientation:{title:'Build a map of the work',detail:'Read the shared background. Distinguish what is already known from the context you still need from a person.'},
      continuity:{title:'Recover the last thread',detail:'Review accepted context and any open instructions before deciding what should happen next.'},
    };
    const focus = preparation[v.service];
    const steps = room ? [
      { title:focus.title, detail:room.sources.length ? focus.detail : 'Ask a person in this space to share the relevant background before proceeding. ' + focus.detail, tool:room.sources.length && v.agent_id ? 'read_space' : null },
      { title:room.inbox.length ? 'Pick up the thread' : 'Use the relationship', detail:room.inbox.length ? 'Read the assigned work, then report actual progress or the input you need.' : room.permissions.assign_work ? 'You may send work through one of the listed authority grants.' : 'You can read shared material. New instructions need permission from the receiving owner.', tool:v.agent_id ? (room.inbox.length ? 'read_inbox' : room.permissions.assign_work ? 'send_instruction' : 'read_space') : null },
      { title:'Carry something forward', detail:room.context.length ? `${room.context.length} accepted ${room.context.length === 1 ? 'piece' : 'pieces'} of guidance can be used by this participant.` : 'Proposed guidance stays a proposal until the receiving person accepts it.', tool:v.agent_id ? 'read_context' : null },
    ] : [
      {title:'Set your purpose',detail:'Your purpose is recorded in your private session. It has not been sent to another agent.',tool:null},
      {title:'Choose a space',detail:ranked.length ? 'Only spaces already accessible to this participant appear here.' : 'A person must create a space or arrange access before an agent can use it.',tool:ranked.length ? 'enter_room' : null},
      {title:'Review permissions',detail:'Read the shared context and available authority before taking action.',tool:null},
    ];
    if(v.status==='departed') message='This session is closed. The summary records what was reported. Closing a session does not close its relationship or shared space.';
    return {visit:v,visitor:agent ? {id:agent.id,name:agent.name,status:agent.status} : {name:this.workspace.user.name,type:'person'},mode:'guided',host:{name:'Accord',service:service.name,message},rooms:ranked,recommended_room_id:recommendation?.id || null,room,steps,boundaries:['The session purpose and outcome notes are private to the signed-in owner.','Opening a space does not create or extend authority.','Other agents act when their own assistant invokes the connection.','Human owners decide which proposed context is accepted.'],receipt:null};
  }
  async perform(action:string, a:Args, channel:'human'|'agent'='human') {
    const agentId=channel==='agent'?field(a,'agent_id',100):undefined;
    if(agentId) {await this.visitor(agentId);await this.workspace.touchAgent(agentId);}
    if(action==='arrive_at_accord') {
      const aid=agentId ?? field(a,'agent_id',100,true); await this.visitor(aid);
      const purpose=field(a,'purpose',2000), service=field(a,'service',40);
      if(!hostServices.some(s=>s.id===service)) throw new AppError('Choose a guidance service.');
      const requestId=field(a,'request_id',100,true);
      if(requestId){const existing=await this.workspace.one('SELECT * FROM host_visits WHERE owner_id=? AND request_key=?',this.workspace.user.id,requestId);if(existing){if(existing.agent_id!==(aid||null)||existing.purpose!==purpose||existing.service!==service)throw new AppError('This session reference is already in use.',409);return this.guide(existing);}}
      const id=crypto.randomUUID(), now=timestamp();
      await this.workspace.stmt('INSERT OR IGNORE INTO host_visits (id,owner_id,agent_id,purpose,service,status,request_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,this.workspace.user.id,aid||null,purpose,service,'arrived',requestId||null,now,now).run();
      const v= requestId ? await this.workspace.one('SELECT * FROM host_visits WHERE owner_id=? AND request_key=?',this.workspace.user.id,requestId) : await this.visit(id);
      if(!v||v.agent_id!==(aid||null)||v.purpose!==purpose||v.service!==service)throw new AppError('This session reference is already in use.',409);
      return this.guide(v);
    }
    const v=await this.visit(field(a,'visit_id',100),agentId);
    if(action==='consult_host')return this.guide(v);
    if(v.status==='departed')throw new AppError('This session is closed. Start a new session.',409);
    if(action==='enter_room') {
      const sid=field(a,'space_id',100);
      if(v.agent_id)await this.workspace.agentAccess(sid,v.agent_id);else await this.workspace.member(sid);
      const result=await this.workspace.stmt('UPDATE host_visits SET room_id=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND status<>? AND EXISTS (SELECT 1 FROM members WHERE space_id=? AND user_id=?) AND (agent_id IS NULL OR EXISTS (SELECT 1 FROM agents a JOIN space_agents sa ON sa.agent_id=a.id WHERE a.id=host_visits.agent_id AND a.owner_id=? AND a.status<>? AND sa.space_id=?))',sid,'inside',timestamp(),v.id,this.workspace.user.id,'departed',sid,this.workspace.user.id,this.workspace.user.id,'revoked',sid).run();
      if(!result.meta.changes)throw new AppError('This session or its access changed. Refresh before opening the space.',409);
    } else if(action==='leave_accord') {
      const outcome=field(a,'outcome',4000);
      const result=await this.workspace.stmt('UPDATE host_visits SET outcome=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND status<>? AND (agent_id IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id=host_visits.agent_id AND a.owner_id=? AND a.status<>?))',outcome,'departed',timestamp(),v.id,this.workspace.user.id,'departed',this.workspace.user.id,'revoked').run();
      if(!result.meta.changes)throw new AppError('This session changed. Refresh before closing it.',409);
    }else throw new AppError('Unknown guidance action.',404);
    return this.guide(await this.visit(v.id,agentId));
  }
}
