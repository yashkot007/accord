'use client';

import { useEffect, useRef, useState } from 'react';
import { clientRequest } from '@/lib/client-request';
import './human-pages.css';

export type ChoiceSource = { kind: 'agents'|'grants'|'sources'|'spaces'; spaceId?:string; owned?:'yes'; capability?:'assign'|'context' };
type Choice=Record<string,any>&{id:string;label:string};
export function PagedSelect({ id, name, label, source, optional=false, initialValue='', onChange, onSelected, disabled=false, onLoading }: {
  id:string; name?:string; label:string; source:ChoiceSource; optional?:boolean; initialValue?:string; onChange?:(value:string)=>void;onSelected?:(item:Choice|undefined)=>void;disabled?:boolean;onLoading?:(loading:boolean)=>void;
}) {
  const [items,setItems]=useState<Choice[]>([]),[cursor,setCursor]=useState<string|null>(null),[value,setValue]=useState(initialValue),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const revision=useRef(0),pending=useRef(false),moreButton=useRef<HTMLButtonElement>(null),select=useRef<HTMLSelectElement>(null);
  const key=JSON.stringify(source);
  async function load(after?:string) {
    if(pending.current)return;pending.current=true;const request=revision.current;setLoading(true);setError('');
    const params=new URLSearchParams({choices:source.kind});if(source.spaceId)params.set('space',source.spaceId);if(source.owned)params.set('owned',source.owned);if(source.capability)params.set('capability',source.capability);if(after)params.set('cursor',after);
    const moreTrigger=moreButton.current,restoreFocus=after&&document.activeElement===moreTrigger;
    try{const page=await clientRequest(`/api/workspace?${params}`);if(revision.current!==request)return;
      const rows:Choice[]=page.items.map((item:Record<string,any>)=>({...item,name:item.name||item.label,label:item.label||item.name}));
      if(!after&&initialValue&&!rows.some(item=>item.id===initialValue)){
        const exact=await clientRequest(source.kind==='agents'?`/api/workspace?profile=${encodeURIComponent(initialValue)}`:`/api/workspace?space=${encodeURIComponent(initialValue)}&header=yes`);
        if(revision.current!==request)return;const item=exact.profile||exact.room;rows.unshift({...item,label:item.name});
      }
      setItems(previous=>after?[...previous,...rows.filter(row=>!previous.some(item=>item.id===row.id))]:rows);setCursor(page.next_cursor);
      if(!after&&initialValue)onSelected?.(rows.find(item=>item.id===initialValue));
      if(restoreFocus&&!page.next_cursor&&document.activeElement===moreTrigger)queueMicrotask(()=>{if(document.activeElement===moreTrigger||(!moreTrigger?.isConnected&&document.activeElement===document.body))select.current?.focus();});
    }catch(failure){if(revision.current===request)setError((failure as Error).message);}
    finally{if(revision.current===request){pending.current=false;setLoading(false);}}
  }
  useEffect(()=>{revision.current++;setItems([]);setCursor(null);setValue(initialValue);pending.current=false;void load();return()=>{revision.current++;};},[key]); // Source fields are represented by key.
  useEffect(()=>{onLoading?.(loading&&!items.length);return()=>{onLoading?.(false);};},[loading,items.length]);
  return <div className="paged-choice">
    <select ref={select} id={id} name={name} value={value} required={!optional} disabled={disabled||loading&&!items.length} onChange={event=>{setValue(event.target.value);onChange?.(event.target.value);onSelected?.(items.find(item=>item.id===event.target.value));}} aria-describedby={error?`${id}-error`:loading?`${id}-status`:undefined}>
      <option value="">{loading&&!items.length?'Loading choices…':optional?'No source selected':'Choose one'}</option>
      {items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {loading&&<span id={`${id}-status`} className="field-help" role="status">Loading choices…</span>}
    {error&&<p id={`${id}-error`} className="error" role="alert">{error} <button type="button" className="text-button" disabled={loading} onClick={()=>void load(cursor||undefined)}>Try again</button></p>}
    {cursor&&<button ref={moreButton} type="button" className="text-button" disabled={loading||disabled} onClick={()=>void load(cursor)} aria-label={`More choices for ${label}`}>{loading?'Loading…':'More choices'}</button>}
  </div>;
}
