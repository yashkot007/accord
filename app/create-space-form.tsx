import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { clientRequest } from '@/lib/client-request';

type Details={name:string;topic:string;purpose:string};
/** Keep the saved space through later attachment failures; retry only the unfinished step. */
export function CreateSpaceForm({purpose,agentId,onBusy,onSaved,onComplete}:{purpose:string;agentId?:string;onBusy:(value:boolean)=>void;onSaved:()=>void;onComplete:(id:string,withAgent:boolean)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const submitRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(error&&!busy)submitRef.current?.focus();},[error,busy]);
  const retry=useRef<{signature:string;id:string}|null>(null),inFlight=useRef(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(inFlight.current)return;
    const form=new FormData(e.currentTarget),details:Details={name:String(form.get('name')||'').trim(),topic:String(form.get('topic')||'').trim(),purpose:String(form.get('purpose')||'').trim()};
    inFlight.current=true;setBusy(true);onBusy(true);setError('');
    try{
      let sid=saved;
      if(!sid){
        const signature=JSON.stringify(details);
        if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
        const receipt=await clientRequest('/api/workspace','create_space',{...details,request_id:retry.current.id});
        sid=receipt.id as string;setSaved(sid);onSaved();
      }
      if(agentId)await clientRequest('/api/workspace','attach_agent',{space_id:sid,agent_id:agentId});
      await onComplete(sid,!!agentId);
    }catch(error){setError((error as Error).message);}
    finally{inFlight.current=false;setBusy(false);onBusy(false);}
  }
  async function openSaved(){
    if(!saved||inFlight.current)return;
    inFlight.current=true;setBusy(true);onBusy(true);setError('');
    try{await onComplete(saved,false);}catch(error){setError((error as Error).message);}
    finally{inFlight.current=false;setBusy(false);onBusy(false);}
  }
  return <>
    <h2>Start with a shared purpose.</h2>
    <p className="dialog-copy">A persistent space for people, agents, and the context they choose to share.{agentId?' Your selected agent will be added to this space.':''} Authority is granted separately.</p>
    <form onSubmit={submit}>
      <label>Space name<input name="name" required maxLength={80} disabled={busy||!!saved} placeholder="Something worth working on together"/></label>
      <label>Shared subject<input name="topic" required maxLength={80} disabled={busy||!!saved} placeholder="e.g. Engineering judgment, writing, career"/></label>
      <label>Purpose<textarea name="purpose" required maxLength={2000} rows={3} disabled={busy||!!saved} defaultValue={purpose}/></label>
      {saved&&<div className="setup-saved" role="status"><Check size={17}/><div><strong>Your space is saved.</strong><p>{agentId?'You can retry adding your agent, or open the space and add it later.':'Open it to continue.'}</p></div></div>}
      {error&&<p className="inn-error" role="alert">{error}</p>}
      <div className="setup-actions"><button ref={submitRef} className="inn-button primary" disabled={busy}>{busy?<><LoaderCircle className="pending-icon" size={16}/>Preparing…</>:saved?(agentId?'Retry adding agent':'Open your space'):'Create this space'}</button>{saved&&agentId&&<button className="inn-button" type="button" disabled={busy} onClick={openSaved}>Open space without agent</button>}</div>
    </form>
  </>;
}
