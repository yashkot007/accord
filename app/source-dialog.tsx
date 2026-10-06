'use client';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {clientRequest,RequestFailure} from '@/lib/client-request';
import {restoreDialogFocus} from '@/lib/dialog-focus';
type Row=Record<string,any>;

export function SourceDialog({sourceId,onClose,onSaved}:{sourceId:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [source,setSource]=useState<Row|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[confirmation,setConfirmation]=useState<'active'|'withdrawn'|null>(null),[mustReview,setMustReview]=useState(false),[notice,setNotice]=useState('');
  async function load(){
    setLoading(true);setError('');setConfirmation(null);
    try{setSource(await clientRequest(`/api/workspace?source=${encodeURIComponent(sourceId)}`));setMustReview(false);}
    catch(e){setSource(null);setError((e as Error).message);}finally{setLoading(false);}
  }
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();void load();return()=>{restoreDialogFocus(previous,`source-${sourceId}`);};},[]);
  async function save(){
    if(!source||!confirmation||saving||loading||mustReview)return;
    setSaving(true);setError('');setNotice('');
    try{
      await clientRequest('/api/workspace','set_source_state',{source_id:sourceId,expected_version:source.version,status:confirmation});
      setNotice(confirmation==='withdrawn'?'Sharing stopped. Future shared reads hide this note.':'Source sharing restored.');
      await onSaved();await load();
    }catch(e){setError((e as Error).message);if(e instanceof RequestFailure&&[403,409].includes(e.status))setMustReview(true);}
    finally{setSaving(false);}
  }
  return <dialog ref={dialog} className="source-dialog" aria-labelledby="source-dialog-title" onCancel={e=>{if(saving)e.preventDefault();else onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow">SHARED CONTEXT</span><h2 id="source-dialog-title">{source?.title||'Shared source'}</h2></div><button className="icon-button" aria-label="Close source" disabled={saving} onClick={onClose}><X size={20}/></button></div>
    {source&&<><div className="source-state"><span className={`badge ${source.status==='active'?'active':'revoked'}`}>{source.status==='active'?'Shared with this space':'Sharing stopped'}</span><span>Version {source.version}</span></div>
      {source.status==='withdrawn'&&<div className="source-notice"><strong>This note is no longer shared.</strong><p>{source.can_manage?'You can view the retained copy here as its author or the space owner. Ordinary shared reads and agent tools receive a withdrawn-source marker.':'Its author or the space owner stopped sharing it. Its title and contents are hidden.'}</p></div>}
      {source.content!==null&&<section aria-label={source.status==='withdrawn'?'Retained management copy':'Source contents'}><p className="small-label">{source.status==='withdrawn'?'RETAINED MANAGEMENT COPY':source.kind}</p><div className="source-content">{source.content}</div></section>}
      <div className="source-boundaries"><h3>You control what stays shared</h3><p>Stopping sharing hides this source from future shared reads and prevents new acceptance of proposals that reference it. Accord retains the note for restoration.</p><p>Existing copies, exports, and text already included in guidance or reports remain. Accepted guidance stays in place until its recipient reconsiders it. Stopping sharing does not delete data.</p><p>The author or space owner can stop sharing while still a member. Only the person who stopped sharing can restore it while still authorized.</p></div>
      {!confirmation?<div className="dialog-actions"><button className="button secondary" onClick={onClose}>Done</button>{source.can_withdraw&&<button className="button primary" disabled={loading||saving||mustReview} onClick={()=>{setNotice('');setConfirmation('withdrawn');}}>Stop sharing</button>}{source.can_restore&&<button className="button primary" disabled={loading||saving||mustReview} onClick={()=>{setNotice('');setConfirmation('active');}}>Restore sharing</button>}</div>:<section className="source-confirm" aria-label="Confirm sharing change"><h3>{confirmation==='withdrawn'?'Stop sharing this note?':'Share this note again?'}</h3><p>{confirmation==='withdrawn'?'People and agents in this space will receive a withdrawn-source marker on their next read. Previous copies and adopted guidance will remain.':'Its title and contents will be available again to the people and agents in this space. Existing guidance decisions will stay unchanged.'}</p><div className="dialog-actions"><button className="button secondary" disabled={saving} onClick={()=>setConfirmation(null)}>Cancel</button><button className="button primary" disabled={saving||loading||mustReview} onClick={save}>{saving?'Saving…':confirmation==='withdrawn'?'Confirm stop sharing':'Confirm restore sharing'}</button></div></section>}
      {source.status==='withdrawn'&&source.can_manage&&!source.can_restore&&<p className="note">Another person stopped sharing this note. You cannot restore it on their behalf.</p>}
    </>}
    {loading&&<p role="status" className="muted">Loading source…</p>}{notice&&<p role="status" className="source-success">{notice}</p>}{error&&<div role="alert" className="error"><p>{error}</p><button className="text-button" disabled={saving||loading} onClick={load}>{mustReview?'Review current sharing':'Reload source'}</button></div>}
  </dialog>;
}
