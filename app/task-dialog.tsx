'use client';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {clientRequest,RequestFailure} from '@/lib/client-request';
import {restoreDialogFocus} from '@/lib/dialog-focus';
type Row=Record<string,any>;
const states:Record<string,string>={queued:'Waiting for agent',working:'In progress',needs_input:'Needs input',completed:'Completed',declined:'Declined'};
const stamp=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export function TaskDialog({taskId,report,onClose,onSaved}:{taskId:string;report:boolean;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),retry=useRef<{signature:string;id:string}|null>(null);
  const [data,setData]=useState<Row|null>(null),[updates,setUpdates]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[mustReview,setMustReview]=useState(false);
  const [expectedVersion,setExpectedVersion]=useState<number|null>(null);
  const [status,setStatus]=useState(''),[feedback,setFeedback]=useState('');
  async function load(next?:string,review=false){
    setLoading(true);setError('');
    try{
      const result=await clientRequest(`/api/workspace?task=${encodeURIComponent(taskId)}${next?`&cursor=${encodeURIComponent(next)}`:''}`);
      setData(result);setExpectedVersion(previous=>review||previous===null?result.task.version:previous);setUpdates(previous=>next?[...previous,...result.updates.filter((u:Row)=>!previous.some(p=>p.id===u.id))]:result.updates);setCursor(result.next_cursor);
      if(review){setMustReview(false);retry.current=null;}
    }catch(e){setError((e as Error).message);}finally{setLoading(false);}
  }
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();void load();return()=>{restoreDialogFocus(previous,`task-history-${taskId}`);};},[]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(!data||mustReview||saving||loading)return;
    const args={task_id:taskId,expected_version:expectedVersion,status,feedback},signature=JSON.stringify(args);
    if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
    setSaving(true);setError('');
    try{await clientRequest('/api/workspace','report_progress',{...args,request_id:retry.current.id});await onSaved();}
    catch(e){setError((e as Error).message);if(e instanceof RequestFailure&&e.status===409)setMustReview(true);}
    finally{setSaving(false);}
  }
  return <dialog ref={dialog} className="task-dialog" aria-labelledby="task-dialog-title" onCancel={e=>{if(saving)e.preventDefault();else onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow">SHARED RECORD</span><h2 id="task-dialog-title">{report?'Report progress':'Instruction history'}</h2></div><button className="icon-button" aria-label="Close history" disabled={saving} onClick={onClose}><X size={20}/></button></div>
    {data&&<><h3 className="task-history-title">{data.task.title}</h3><p className="task-history-body">{data.task.body}</p><div className="task-current"><span className={`badge ${data.task.status}`}>{states[data.task.status]}</span><span>Version {data.task.version}</span></div>{data.task.feedback&&<div className="task-latest"><strong>Latest saved report</strong><p>{data.task.feedback}</p></div>}
      {report&&<form onSubmit={submit} className="progress-form"><p className="field-help">Your report is shared with everyone in this space. Describe what happened, including evidence or what you need next.</p><div className="form-field"><label htmlFor="progress-state">Progress</label><select id="progress-state" required value={status} onChange={e=>setStatus(e.target.value)} disabled={saving}><option value="">Choose one</option>{Object.entries(states).filter(([s])=>s!=='queued').map(([s,label])=><option key={s} value={s}>{label}</option>)}</select></div><div className="form-field"><label htmlFor="progress-feedback">New update or result</label><textarea id="progress-feedback" required maxLength={8000} rows={4} value={feedback} onChange={e=>setFeedback(e.target.value)} disabled={saving}/></div>{!data.task.can_report&&<p className="note">This instruction is closed or current authority does not allow another report. Your draft is still here.</p>}{mustReview&&<button type="button" className="button secondary" disabled={loading} onClick={()=>load(undefined,true)}>Review latest history</button>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving||loading||mustReview||!data.task.can_report}>{saving?'Saving…':'Save progress'}</button></div></form>}
      <section className="task-history" aria-label="Progress history"><h3>Progress history</h3><p className="field-help">Reported by participants; outcomes are not independently verified.</p>{updates.length?<ol>{updates.map(u=><li key={u.id}><div className="history-heading"><strong>{states[u.status]||u.status}</strong><time dateTime={u.created_at}>{stamp(u.created_at)}</time></div><p>{u.feedback}</p><span className="history-author">{u.channel==='legacy'?'Earlier saved feedback · reporter not recorded':u.channel==='agent'?`${u.agent_name||'Agent profile'} · via ${u.actor_name||'Account owner'}’s connection`:`${u.actor_name||'Space member'} · reported personally`} · Version {u.version}</span></li>)}</ol>:<p className="muted">No progress reports yet.</p>}{updates.some(u=>u.channel==='legacy')&&<p className="field-help">Only the last saved feedback from before history was enabled is available. Earlier overwritten reports cannot be recovered.</p>}{cursor&&<button className="button secondary" disabled={loading||saving} onClick={()=>load(cursor)}>Load more reports</button>}</section></>}
    {loading&&<p className="muted" role="status">Loading history…</p>}{error&&<div role="alert" className="error"><p>{error}</p>{!mustReview&&<button className="text-button" disabled={loading||saving} onClick={()=>load()}>Reload history</button>}</div>}
  </dialog>;
}
