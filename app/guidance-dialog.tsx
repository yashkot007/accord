'use client';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {clientRequest,RequestFailure} from '@/lib/client-request';
import {restoreDialogFocus} from '@/lib/dialog-focus';
type Row=Record<string,any>;
const labels:Record<string,string>={accepted:'Accepted',declined:'Declined',pending:'Open for review'};
const stamp=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export function GuidanceDialog({changeId,review,onClose,onSaved}:{changeId:string;review:boolean;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),retry=useRef<{signature:string;id:string}|null>(null),initialized=useRef(false);
  const [data,setData]=useState<Row|null>(null),[history,setHistory]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [baseline,setBaseline]=useState<{version:number;sourceVersion:number|null}|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[mustReview,setMustReview]=useState(false),[notice,setNotice]=useState('');
  const [focusDraft,setFocusDraft]=useState(0);
  useEffect(()=>{if(focusDraft)document.getElementById('guidance-instruction')?.focus();},[focusDraft]);
  const [decision,setDecision]=useState(''),[instruction,setInstruction]=useState(''),[note,setNote]=useState('');
  async function load(next?:string,refreshReview=false){
    setLoading(true);setError('');
    try{
      const result=await clientRequest(`/api/workspace?change=${encodeURIComponent(changeId)}${next?`&cursor=${encodeURIComponent(next)}`:''}`);
      setData(result);setHistory(old=>next?[...old,...result.history.filter((h:Row)=>!old.some(x=>x.id===h.id))]:result.history);setCursor(result.next_cursor);
      if(!initialized.current){setInstruction(result.current.adopted||result.current.instruction);setDecision(result.current.status==='pending'?'accepted':'');initialized.current=true;}
      setBaseline(old=>!old||refreshReview?{version:result.current.version,sourceVersion:result.current.source_version}:old);
      if(refreshReview){setMustReview(false);retry.current=null;}
    }catch(e){setError((e as Error).message);}finally{setLoading(false);}
  }
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();void load();return()=>{restoreDialogFocus(previous,`guidance-history-${changeId}`);};},[]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(!data||!baseline||saving||loading||mustReview||!decision)return;
    const args={change_id:changeId,expected_version:baseline.version,expected_source_version:decision==='accepted'?baseline.sourceVersion:undefined,decision,instruction:decision==='accepted'?instruction:undefined,decision_note:note};
    const signature=JSON.stringify(args);if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
    setSaving(true);setError('');
    try{await clientRequest('/api/workspace','decide_context',{...args,request_id:retry.current.id});await onSaved();}
    catch(e){setError((e as Error).message);if(e instanceof RequestFailure&&[403,409].includes(e.status))setMustReview(true);}
    finally{setSaving(false);}
  }
  function usePrior(text:string){setInstruction(text);setDecision('accepted');setNotice('Earlier wording copied into your draft. Review it and save a new decision to adopt it.');setFocusDraft(n=>n+1);}
  return <dialog ref={dialog} className="guidance-dialog" aria-labelledby="guidance-dialog-title" onCancel={e=>{if(saving)e.preventDefault();else onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow">GUIDANCE & DECISIONS</span><h2 id="guidance-dialog-title">{review?'Review guidance':'Guidance history'}</h2></div><button className="icon-button" aria-label="Close guidance" disabled={saving} onClick={onClose}><X size={20}/></button></div>
    {data&&<><h3 className="guidance-title">{data.current.title}</h3><div className="task-current"><span className={`badge ${data.current.status}`}>{labels[data.current.status]}</span><span>Decision version {data.current.version}</span></div>
      <section className="guidance-current" aria-label="Current guidance"><strong>{data.current.status==='accepted'?'Currently accepted wording':'Original proposed wording'}</strong><p>{data.current.status==='accepted'?data.current.adopted:data.current.instruction}</p><span>Applies to {data.current.scope}</span></section>
      <div className="guidance-reason"><strong>Why it was proposed</strong><p>{data.current.reason}</p></div>
      {data.current.source_id&&<p className="source-warning">{data.current.source_status==='active'?`Linked source is shared · source version ${data.current.source_version}`:'The linked source is withdrawn or unavailable. Previously accepted guidance remains until its recipient reconsiders it.'}</p>}
      {review&&data.current.can_decide?<form className="guidance-form" onSubmit={submit}>
        <p className="field-help">Your decision, wording, and note are shared with this space. Earlier decisions remain in history. Only the current accepted wording is active guidance.</p>
        <div className="form-field"><label htmlFor="guidance-decision">Your decision</label><select id="guidance-decision" required value={decision} disabled={saving} onChange={e=>setDecision(e.target.value)}><option value="">Choose a decision</option><option value="accepted">Accept guidance</option><option value="declined">Decline guidance</option><option value="pending">Reconsider · remove from active guidance</option></select></div>
        {decision==='accepted'&&<div className="form-field"><label htmlFor="guidance-instruction">Wording to carry forward</label><textarea id="guidance-instruction" required rows={5} maxLength={5000} value={instruction} disabled={saving} onChange={e=>setInstruction(e.target.value)}/></div>}
        <div className="form-field"><label htmlFor="guidance-note">Why this decision?<span> · optional, shared with this space</span></label><textarea id="guidance-note" rows={3} maxLength={2000} value={note} disabled={saving} onChange={e=>setNote(e.target.value)} placeholder="What changed your mind, or when should this be revisited?"/></div>
        {decision==='accepted'&&!data.current.can_accept&&<p className="note">Acceptance requires current authority, active profiles, and an available linked source. You can still decline or reconsider.</p>}
        {decision&&decision!=='accepted'&&<p className="note">This removes the guidance from future active-context reads. Earlier decisions, exported copies, and provider memory are not erased.</p>}
        {mustReview&&<button type="button" className="button secondary" disabled={loading||saving} onClick={()=>load(undefined,true)}>Review latest decision</button>}
        <div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving||loading||mustReview||!decision||(decision==='accepted'&&!data.current.can_accept)}>{saving?'Saving…':'Save decision'}</button></div>
      </form>:review?<p className="note">Only the receiving agent’s current owner can decide while a member of this space.</p>:null}
      <section className="decision-history" aria-label="Decision history"><h3>Decision history</h3><p className="field-help">A shared record of earlier decisions. Historical wording is not active guidance.</p>
        {history.length?<ol>{history.map(h=><li key={h.id}><div className="history-heading"><strong>{labels[h.status]}</strong><time dateTime={h.created_at}>{stamp(h.created_at)}</time></div><span className="history-author">{h.channel==='legacy'?'Earlier saved state · decision-maker not recorded':`${h.actor_name||'Receiving owner'} · decided personally`} · Version {h.version}</span>
          {h.adopted&&<div className="historical-wording"><span>WORDING SAVED WITH THIS DECISION</span><p>{h.adopted}</p></div>}{h.note&&<div className="decision-note"><strong>Decision note</strong><p>{h.note}</p></div>}
          {h.source_id&&<p className="field-help">{h.channel==='legacy'?'Source state at that time was not recorded.':`Source at this decision: ${h.source_status}${h.source_version!==null?` · version ${h.source_version}`:''}. This may differ from its current state.`}</p>}
          {review&&data.current.can_decide&&h.adopted&&<button type="button" className="text-button" disabled={saving||loading} onClick={()=>usePrior(h.adopted)}>Use this wording as a draft</button>}
        </li>)}</ol>:<p className="muted">No human decisions have been recorded yet.</p>}
        {history.some(h=>h.channel==='legacy')&&<p className="field-help">Only the last saved state from before decision history was enabled is available. Earlier overwritten decisions cannot be recovered.</p>}
        {cursor&&<button className="button secondary" disabled={loading||saving} onClick={()=>load(cursor)}>Load more decisions</button>}
      </section>
    </>}
    {notice&&<p role="status" className="source-success">{notice}</p>}{loading&&<p role="status" className="muted">Loading guidance…</p>}{error&&<div role="alert" className="error"><p>{error}</p>{!mustReview&&<button className="text-button" disabled={loading||saving} onClick={()=>load()}>Reload guidance</button>}</div>}
  </dialog>;
}
