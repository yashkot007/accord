'use client';
import {useEffect,useRef,useState} from 'react';
import {X,ShieldCheck} from 'lucide-react';
import {clientRequest,RequestFailure} from '@/lib/client-request';
type Row=Record<string,any>;
export type MembershipAction='leave_space'|'remove_member'|'transfer_ownership';
export function MembershipDialog({spaceId,userId,action,onClose,onSaved}:{spaceId:string;userId:string;action:MembershipAction;onClose:()=>void;onSaved:(receipt:Row)=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),retry=useRef<string|null>(null),inFlight=useRef(false),reviewButton=useRef<HTMLButtonElement>(null);
  const [data,setData]=useState<Row|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[mustReview,setMustReview]=useState(false);
  const transfer=action==='transfer_ownership',leaving=action==='leave_space';
  const label=transfer?'Transfer ownership':leaving?'Leave space':'Remove access';
  const allowed=!!data?.[transfer?'can_transfer':leaving?'can_leave':'can_remove'];
  async function load(){
    setLoading(true);setError('');
    try{const result=await clientRequest(`/api/workspace?space=${encodeURIComponent(spaceId)}&membership=${encodeURIComponent(userId)}`);setData(result);setMustReview(false);retry.current=null;}
    catch(e){setData(null);setError((e as Error).message);}
    finally{setLoading(false);}
  }
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();void load();return()=>{const target=previous?.isConnected?previous:document.getElementById(`membership-${userId}`)||document.getElementById('people-heading');target?.focus();};},[]);
  useEffect(()=>{if(mustReview&&!saving)reviewButton.current?.focus();},[mustReview,saving]);
  async function submit(e:React.FormEvent){
    e.preventDefault();if(!data||!allowed||loading||mustReview||inFlight.current)return;
    inFlight.current=true;setSaving(true);setError('');if(!retry.current)retry.current=crypto.randomUUID();
    try{const result=await clientRequest('/api/workspace',action,{space_id:spaceId,user_id:userId,expected_membership_key:data.member.membership_key,expected_space_version:data.space.membership_version,request_id:retry.current});await onSaved(result);}
    catch(e){setError((e as Error).message);if(e instanceof RequestFailure&&[403,409].includes(e.status))setMustReview(true);}
    finally{inFlight.current=false;setSaving(false);}
  }
  return <dialog ref={dialog} className="membership-dialog" aria-labelledby="membership-title" onCancel={e=>{if(saving)e.preventDefault();else onClose();}}>
    <div className="dialog-heading"><div><span className="eyebrow">PEOPLE & PERMISSIONS</span><h2 id="membership-title">{label}</h2></div><button className="icon-button" aria-label="Close membership review" disabled={saving} onClick={onClose}><X size={20}/></button></div>
    {loading&&<p role="status" className="muted">Checking current membership…</p>}
    {data&&<><div className="membership-summary"><ShieldCheck size={19}/><div><strong>{data.space.name}</strong><span>{data.member.name||'Space member'} · {data.member.role}</span></div></div>
      <p className="dialog-description">{transfer?`${data.member.name||'This person'} will become the owner of this space.`:leaving?'You and your agents will lose access to this space.':`${data.member.name||'This person'} and their agents will lose access to this space.`}</p>
      <ul className="membership-effects">{transfer?<><li>The new owner can invite and remove people, manage shared sources, and transfer ownership.</li><li>You remain a participant. You can leave afterwards.</li><li>Existing agent permissions and accepted guidance stay unchanged. Unused invitations issued by you stop working.</li></>:<><li>Agent connections to this space are removed and their permissions here are revoked. Profiles in other spaces stay available.</li><li>Shared notes, work and history remain with the space. Recipients keep guidance they already accepted.</li><li>{leaving?'You':'This person'} will no longer be able to manage previously shared notes here. {leaving?'Review or stop sharing them before leaving.':'Review any source-sharing concerns before continuing.'}</li><li>Private sessions and their reported outcomes remain with their owner. Returning requires a new invitation; agents and permissions must be added again.</li></>}</ul>
      {!allowed&&<p className="note">{leaving&&data.space.owner_id===userId?'Transfer ownership to another member before leaving.':'Your current role does not allow this change.'}</p>}
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
    {(mustReview||(!data&&!loading))&&<button ref={reviewButton} className="button secondary" disabled={loading||saving} onClick={load}>Review current membership</button>}
    <form onSubmit={submit}><div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Close</button><button className="button primary" disabled={loading||saving||mustReview||!allowed}>{saving?'Saving…':label}</button></div></form>
  </dialog>;
}
