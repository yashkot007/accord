import { ArrowRight, ArrowUpRight, BookOpen, Check, History, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
type Row=Record<string,any>;
const when=(value:string)=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(value));
export default function ReturnHome({name,home,openSessions,outcomes,busy,onOpen,onResume,onNew,onHistory,onRefresh}:{
  name:string;home:Row;openSessions:Row[];outcomes:Row[];busy:boolean;
  onOpen:(id:string,tab:string)=>void;onResume:(session:Row)=>void;onNew:()=>void;onHistory:()=>void;onRefresh:()=>void;
}){
  const reviews:Row[]=home.reviews||[],work:Row[]=home.work||[],guidance:Row[]=home.guidance||[];
  return <section className="return-home" aria-labelledby="return-title">
    <div className="return-heading"><div><p className="return-eyebrow">WELCOME BACK, {name.split(' ')[0].toLocaleUpperCase()}</p><h1 id="return-title">Pick up with <em>context.</em></h1><p>Your decisions, shared work, and the threads you’re carrying forward.</p></div><button className="inn-button primary" onClick={onNew}>Start a session<ArrowUpRight size={16}/></button></div>
    <div className="return-grid">
      <section className="attention-panel" aria-labelledby="attention-title"><div className="return-section-heading"><h2 id="attention-title">Needs your attention</h2><button className="inn-icon" aria-label="Refresh your next steps" disabled={busy} onClick={onRefresh}><RefreshCw size={15}/></button></div>
        {reviews.length||work.length?<div className="next-items">
          {reviews.slice(0,4).map(item=><button className="next-item" key={'review'+item.id} onClick={()=>onOpen(item.space_id,'context')}><span className="next-icon"><ShieldCheck size={19}/></span><span><small>{item.can_accept?'GUIDANCE TO REVIEW':'REVIEW · AUTHORITY INACTIVE'}</small><strong>{item.title}</strong><span>{item.space_name} · for {item.agent_name}</span></span><ArrowRight size={17}/></button>)}
          {work.slice(0,Math.max(1,5-Math.min(reviews.length,4))).map(item=><button className="next-item" key={'work'+item.id} onClick={()=>onOpen(item.space_id,'work')}><span className="next-icon work"><MessageCircle size={19}/></span><span><small>{item.status==='needs_input'?'INPUT NEEDED':item.status==='working'?'IN PROGRESS':'WAITING FOR YOUR AGENT'}</small><strong>{item.title}</strong><span>{item.space_name} · {item.agent_name}</span></span><ArrowRight size={17}/></button>)}
          {(reviews.length>4||work.length>Math.max(1,5-Math.min(reviews.length,4)))&&<p className="return-fine">Showing your next few items. Open a space for its full review and work lists.</p>}
        </div>:<div className="return-empty"><span><Check size={23}/></span><h3>You’re up to date.</h3><p>No guidance is waiting for your review and no active work needs your attention. Continue a conversation when you have something to bring.</p><button className="text-link" onClick={onNew}>Begin with a new question<ArrowRight size={14}/></button></div>}
        <div className="attention-foot"><ShieldCheck size={13}/><span>Only you decide what becomes your agent’s guidance.</span></div>
      </section>
      <section className="continue-panel" aria-labelledby="continue-title"><div className="return-section-heading"><h2 id="continue-title">Keep the thread</h2><button className="text-link" onClick={onHistory}>History<ArrowUpRight size={13}/></button></div>
        {openSessions.length?<div className="continue-items">{openSessions.slice(0,3).map(item=><button className="continue-item" key={item.id} disabled={busy} onClick={()=>onResume(item)}><span className="continue-label"><History size={13}/>{item.agent_status==='revoked'?'DISCONNECTED AGENT · CLOSE SESSION':'CONTINUE SESSION'}</span><strong>{item.purpose}</strong><span>{item.agent_name||'You'} · {when(item.updated_at)}<ArrowUpRight size={15}/></span></button>)}</div>:<div className="continue-quiet"><History size={22}/><p>No open sessions. Your completed outcomes are here whenever you need the background.</p><button className="text-link" onClick={onHistory}>Open your history<ArrowRight size={14}/></button></div>}
        {outcomes[0]&&<button className="last-outcome" onClick={()=>onResume(outcomes[0])}><span>LAST RECORDED OUTCOME · {when(outcomes[0].updated_at)}</span><p>{outcomes[0].outcome}</p><small>Private to you · reported outcome<ArrowUpRight size={13}/></small></button>}
      </section>
    </div>
    {guidance.length>0&&<section className="carried-context" aria-labelledby="carried-title"><div className="return-section-heading"><div><h2 id="carried-title">Guidance you’re carrying forward</h2><p>Owner-approved context, ready to read or export. Use by another agent is not automatically verified.</p></div><BookOpen size={20}/></div><div className="carried-items">{guidance.slice(0,3).map(item=><button key={item.id} onClick={()=>onOpen(item.space_id,'context')}><span>{item.scope}</span><strong>{item.title}</strong><small>{item.agent_name}<ArrowUpRight size={14}/></small></button>)}</div></section>}
  </section>;
}
