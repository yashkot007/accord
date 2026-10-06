import { AppError, field, Workspace, type Args, pageRequest } from './workspace.ts';

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
    if (v.agent_id && agentId !== undefined) await this.visitor(v.agent_id);
    return v;
  }
  async rooms(agentId: string) {
    if(agentId)return this.workspace.listAgentRooms({limit:20},agentId);
    const rows=await this.workspace.all('SELECT s.id,s.name,s.topic,s.purpose,s.created_at FROM spaces s JOIN members m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 21',this.workspace.user.id);
    return {spaces:rows.slice(0,20),next_cursor:null,more:rows.length>20};
  }
  async arrivals(cursor?: string) {
    let after:{at:string;id:string}|null=null;
    if(cursor){
      try{const c=JSON.parse(cursor);if(typeof c.at!=='string'||typeof c.id!=='string'||c.id.length>100||!Number.isFinite(Date.parse(c.at)))throw Error();after=c;}catch{throw new AppError('This history reference is invalid. Refresh your sessions.');}
    }
    const select=`SELECT v.*,a.name AS agent_name,a.status AS agent_status,s.name AS room_name FROM host_visits v LEFT JOIN agents a ON a.id=v.agent_id LEFT JOIN spaces s ON s.id=v.room_id AND EXISTS (SELECT 1 FROM members m WHERE m.space_id=s.id AND m.user_id=v.owner_id) WHERE v.owner_id=?`;
    const [page,open]=await Promise.all([
      this.workspace.all(`${select}${after?' AND (v.updated_at<? OR (v.updated_at=? AND v.id<?))':''} ORDER BY v.updated_at DESC,v.id DESC LIMIT 31`,this.workspace.user.id,...(after?[after.at,after.at,after.id]:[])),
      this.workspace.all(`${select} AND v.status<>'departed' ORDER BY v.updated_at DESC,v.id DESC LIMIT 5`,this.workspace.user.id)
    ]);
    const visits=page.slice(0,30),last=visits.at(-1);
    return {visits,open_sessions:open,next_cursor:page.length>30&&last?JSON.stringify({at:last.updated_at,id:last.id}):null,mode:'guided',services:hostServices.map(({keywords,...s})=>s)};
  }
  async agentSessions(a:Args) {
    const agentId=field(a,'agent_id',100);await this.workspace.ownedAgent(agentId);
    const status=field(a,'status',30,true);
    if(status&&!['open','closed'].includes(status))throw new AppError('Choose open or closed sessions.');
    const page=pageRequest(a,JSON.stringify(['sessions',this.workspace.user.id,agentId,status]));
    const note='Private sessions for this profile only. Use a returned visit ID to consult or close a session.';
    const from=`FROM host_visits v JOIN agents agent ON agent.id=v.agent_id
      WHERE v.owner_id=? AND v.agent_id=? AND agent.owner_id=? AND agent.status<>'revoked'
      ${status==='open'?" AND v.status<>'departed'":status==='closed'?" AND v.status='departed'":''}
      ${page.after?' AND (v.created_at>? OR (v.created_at=? AND v.id>?))':''}`;
    const result=await this.workspace.largeAgentPage(page,'sessions',{note},{select:'v.*',from,values:[this.workspace.user.id,agentId,this.workspace.user.id,...(page.after?[page.after.at,page.after.at,page.after.id]:[])],order:'v.created_at,v.id',id:'v.id',at:'v.created_at',versionField:'updated_at',fields:{id:'v.id',owner_id:'v.owner_id',agent_id:'v.agent_id',purpose:'v.purpose',service:'v.service',status:'v.status',room_id:'v.room_id',outcome:'v.outcome',request_key:'v.request_key',created_at:'v.created_at',updated_at:'v.updated_at'}});
    return {sessions:result.items,next_cursor:result.next_cursor,...('oversized_record' in result?{oversized_record:true}:{}),note};
  }
  async guide(v: Record<string, any>) {
    if (v.status === 'departed') return { visit:v, visitor:{name:'Participant'}, mode:'guided', host:{name:'Accord',service:hostServices.find(s=>s.id===v.service)?.name,message:'This session is closed. The summary records what was reported. Closing a session does not close its relationship or shared space.'},rooms:[],recommended_room_id:null,room:null,steps:[],boundaries:[],receipt:{outcome:v.outcome,recorded_at:v.updated_at,source:'Reported by the participant; not independently verified'} };
    if(v.agent_id&&(await this.workspace.ownedAgent(v.agent_id,true)).status==='revoked')return {visit:v,visitor:{name:'Disconnected agent'},mode:'guided',restricted:true,host:{name:'Accord',message:'This agent is disconnected. You can still record an outcome and close your private session. Shared context and agent actions are unavailable.'},rooms:[],room:null,steps:[],boundaries:[],receipt:null};
    const agent = await this.visitor(v.agent_id || ''), catalog = await this.rooms(v.agent_id || ''),rooms=catalog.spaces as Record<string,any>[];
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
    if(v.room_id) {
      try {room=await this.workspace.hostRoom(v.room_id,v.agent_id||undefined);}
      catch(error){if(!(error instanceof AppError)||error.status!==403)throw error;}
      if(room)message=`You’re in “${room.name}”. ${room.more.sources?'Shared sources are available; read the source pages for the complete list.':room.sources.length?`${room.sources.length} shared ${room.sources.length===1?'source is':'sources are'} available for this session.`:'Start by sharing the background this relationship needs.'} ${room.more.inbox?'Open instructions are assigned; read every inbox page.':room.inbox.length?`${room.inbox.length} ${room.inbox.length===1?'instruction awaits':'instructions await'} this participant.`:'No open instructions are assigned to this participant.'}`;
    }
    const preparation: Record<string, {title:string;detail:string}> = {
      perspective:{title:'Frame the decision',detail:'Use the shared background to name the decision, your current assumption, and the perspective you are seeking.'},
      learn:{title:'Start from what is understood',detail:'Use the shared lesson material to identify one question or skill to work through with this relationship.'},
      orientation:{title:'Build a map of the work',detail:'Read the shared background. Distinguish what is already known from the context you still need from a person.'},
      continuity:{title:'Recover the last thread',detail:'Review accepted context and any open instructions before deciding what should happen next.'},
    };
    const focus = preparation[v.service];
    const steps = room ? [
      { title:focus.title, detail:room.sources.length ? 'Read the relevant shared source by its ID. '+focus.detail : 'Ask a person in this space to share the relevant background before proceeding. ' + focus.detail, tool:room.sources.length && v.agent_id ? 'read_shared_source' : null },
      { title:room.inbox.length ? 'Pick up the thread' : 'Use the relationship', detail:room.inbox.length ? 'Read the assigned work, then report actual progress or the input you need.' : room.permissions.assign_work ? 'Read grant pages to find a current connection permitting assignment before sending work.' : 'You can read shared material. New instructions need permission from the receiving owner.', tool:v.agent_id ? (room.inbox.length ? 'read_inbox' : room.permissions.assign_work ? 'read_space_section' : 'read_space') : null },
      { title:'Carry something forward', detail:room.context.length ? `${room.context.length} accepted ${room.context.length === 1 ? 'piece' : 'pieces'} of guidance can be used by this participant.` : 'Proposed guidance stays a proposal until the receiving person accepts it.', tool:v.agent_id ? 'read_context' : null },
    ] : [
      {title:'Set your purpose',detail:'Your purpose is recorded in your private session. It has not been sent to another agent.',tool:null},
      {title:'Choose a space',detail:ranked.length ? 'Only spaces already accessible to this participant appear here.' : 'A person must create a space or arrange access before an agent can use it.',tool:ranked.length ? 'enter_room' : null},
      {title:'Review permissions',detail:'Read the shared context and available authority before taking action.',tool:null},
    ];
    if(v.status==='departed') message='This session is closed. The summary records what was reported. Closing a session does not close its relationship or shared space.';
    return {visit:v,visitor:agent ? {id:agent.id,name:agent.name,status:agent.status} : {name:this.workspace.user.name,type:'person'},mode:'guided',host:{name:'Accord',service:service.name,message},rooms:ranked,rooms_next_cursor:catalog.next_cursor,rooms_complete:!catalog.next_cursor&&!catalog.more,recommendation_scope:'The rooms shown on this page. Use list_spaces for further agent-room pages.',recommended_room_id:recommendation?.id || null,room,steps,boundaries:['The session purpose and outcome notes are private to the signed-in owner.','Opening a space does not create or extend authority.','Other agents act when their own assistant invokes the connection.','Human owners decide which proposed context is accepted.'],receipt:null};
  }
  async perform(action:string, a:Args, channel:'human'|'agent'='human') {
    const agentId=channel==='agent'?field(a,'agent_id',100):undefined;
    if(agentId) await this.workspace.touchAgent(agentId);
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
    if(v.status==='departed'){if(action==='leave_accord'&&v.outcome===field(a,'outcome',4000))return this.guide(v);throw new AppError('This session is closed. Its recorded outcome cannot be replaced.',409);}
    if(action==='enter_room') {
      const sid=field(a,'space_id',100);
      if(v.agent_id)await this.workspace.agentAccess(sid,v.agent_id);else await this.workspace.member(sid);
      const result=await this.workspace.stmt('UPDATE host_visits SET room_id=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND status<>? AND EXISTS (SELECT 1 FROM members WHERE space_id=? AND user_id=?) AND (agent_id IS NULL OR EXISTS (SELECT 1 FROM agents a JOIN space_agents sa ON sa.agent_id=a.id WHERE a.id=host_visits.agent_id AND a.owner_id=? AND a.status<>? AND sa.space_id=?))',sid,'inside',timestamp(),v.id,this.workspace.user.id,'departed',sid,this.workspace.user.id,this.workspace.user.id,'revoked',sid).run();
      if(!result.meta.changes)throw new AppError('This session or its access changed. Refresh before opening the space.',409);
    } else if(action==='leave_accord') {
      const outcome=field(a,'outcome',4000);
      const result=await this.workspace.stmt(`UPDATE host_visits SET outcome=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND status<>? AND (?='human' OR agent_id IS NULL OR EXISTS (SELECT 1 FROM agents a WHERE a.id=host_visits.agent_id AND a.owner_id=? AND a.status<>?))`,outcome,'departed',timestamp(),v.id,this.workspace.user.id,'departed',channel,this.workspace.user.id,'revoked').run();
      if(!result.meta.changes)throw new AppError('This session changed. Refresh before closing it.',409);
    }else throw new AppError('Unknown guidance action.',404);
    return this.guide(await this.visit(v.id,agentId));
  }
}
