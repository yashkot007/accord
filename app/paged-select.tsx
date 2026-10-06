'use client';

import { useEffect, useRef, useState } from 'react';
import { clientRequest, RequestFailure } from '@/lib/client-request';
import './human-pages.css';

export type ChoiceSource = { kind: 'agents'|'grants'|'sources'|'spaces'; spaceId?:string; owned?:'yes'; capability?:'assign'|'context' };
type Choice=Record<string,any>&{id:string;label:string};
export function PagedSelect({ id, name, label, source, optional=false, initialValue='', onChange, onSelected, disabled=false, onLoading }: {
  id:string; name?:string; label:string; source:ChoiceSource; optional?:boolean; initialValue?:string; onChange?:(value:string)=>void;onSelected?:(item:Choice|undefined)=>void;disabled?:boolean;onLoading?:(loading:boolean)=>void;
}) {
  const [items,setItems]=useState<Choice[]>([]),[cursor,setCursor]=useState<string|null>(null),[value,setValue]=useState(initialValue),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [restartRequired,setRestartRequired]=useState(false),[refreshing,setRefreshing]=useState(false),[selectionHelp,setSelectionHelp]=useState('');
  const revision=useRef(0),pending=useRef(false),moreButton=useRef<HTMLButtonElement>(null),retryButton=useRef<HTMLButtonElement>(null),select=useRef<HTMLSelectElement>(null),selectedValue=useRef(initialValue),retainedSelection=useRef('');
  const key=JSON.stringify(source);
  async function load(after?:string,fresh=false) {
    if(pending.current)return;pending.current=true;const request=revision.current;setLoading(true);setRefreshing(fresh);
    const params=new URLSearchParams({choices:source.kind});if(source.spaceId)params.set('space',source.spaceId);if(source.owned)params.set('owned',source.owned);if(source.capability)params.set('capability',source.capability);if(after)params.set('cursor',after);
    const moreTrigger=moreButton.current,retryTrigger=retryButton.current,focusTrigger=document.activeElement===retryTrigger?retryTrigger:after&&document.activeElement===moreTrigger?moreTrigger:null;
    try{const page=await clientRequest(`/api/workspace?${params}`);if(revision.current!==request)return;
      const rows:Choice[]=page.items.map((item:Record<string,any>)=>({...item,name:item.name||item.label,label:item.label||item.name}));
      if(!after&&!fresh&&initialValue&&!rows.some(item=>item.id===initialValue)){
        const exact=await clientRequest(source.kind==='agents'?`/api/workspace?profile=${encodeURIComponent(initialValue)}`:`/api/workspace?space=${encodeURIComponent(initialValue)}&header=yes`);
        if(revision.current!==request)return;const item=exact.profile||exact.room;rows.unshift({...item,label:item.name});
      }
      setItems(previous=>after?[...previous,...rows.filter(row=>!previous.some(item=>item.id===row.id))]:rows);setCursor(page.next_cursor);setError('');setRestartRequired(false);
      const savedSelection=fresh?selectedValue.current||retainedSelection.current:after?retainedSelection.current:'';
      if(savedSelection){
        const selected=rows.find(item=>item.id===savedSelection);
        if(selected){selectedValue.current=savedSelection;retainedSelection.current='';setValue(savedSelection);setSelectionHelp('');onChange?.(savedSelection);onSelected?.(selected);}
        else if(fresh){selectedValue.current='';retainedSelection.current=savedSelection;setValue('');setSelectionHelp(page.next_cursor?'Your previous choice needs to be checked. Load more choices or choose another.':'Your previous choice is no longer available. Choose another.');onChange?.('');onSelected?.(undefined);}
        else if(!page.next_cursor)setSelectionHelp('Your previous choice is no longer available. Choose another.');
      }
      if(!after&&!fresh&&initialValue)onSelected?.(rows.find(item=>item.id===initialValue));
      if(focusTrigger&&(focusTrigger===retryTrigger||!page.next_cursor))queueMicrotask(()=>{if(revision.current===request&&(document.activeElement===focusTrigger||(!focusTrigger.isConnected&&document.activeElement===document.body)))select.current?.focus();});
    }catch(failure){if(revision.current===request){const changed=!!after&&failure instanceof RequestFailure&&failure.status===400;setError(changed?'These choices changed. Try again to refresh them.':(failure as Error).message);if(changed)setRestartRequired(true);}}
    finally{if(revision.current===request){pending.current=false;setLoading(false);setRefreshing(false);}}
  }
  useEffect(()=>{revision.current++;setItems([]);setCursor(null);setValue(initialValue);selectedValue.current=initialValue;retainedSelection.current='';setError('');setRestartRequired(false);setSelectionHelp('');pending.current=false;void load();return()=>{revision.current++;};},[key]); // Source fields are represented by key.
  useEffect(()=>{onLoading?.(loading&&(!items.length||refreshing));return()=>{onLoading?.(false);};},[loading,items.length,refreshing]);
  return <div className="paged-choice">
    <select ref={select} id={id} name={name} value={value} required={!optional} disabled={disabled||loading&&(!items.length||refreshing)} onChange={event=>{selectedValue.current=event.target.value;retainedSelection.current='';setValue(event.target.value);setSelectionHelp('');onChange?.(event.target.value);onSelected?.(items.find(item=>item.id===event.target.value));}} aria-describedby={[error?`${id}-error`:loading?`${id}-status`:'',selectionHelp?`${id}-selection`:''].filter(Boolean).join(' ')||undefined}>
      <option value="">{loading&&!items.length?'Loading choices…':optional?'No source selected':'Choose one'}</option>
      {items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {loading&&<span id={`${id}-status`} className="field-help" role="status">Loading choices…</span>}
    {selectionHelp&&<p id={`${id}-selection`} className="field-help" role="status">{selectionHelp}</p>}
    {error&&<p id={`${id}-error`} className="error" role="alert">{error} <button ref={retryButton} type="button" className="text-button" disabled={disabled} aria-disabled={loading||disabled} onClick={()=>{if(!disabled)void load(restartRequired?undefined:cursor||undefined,restartRequired);}}>Try again</button></p>}
    {cursor&&!restartRequired&&<button ref={moreButton} type="button" className="text-button" disabled={disabled} aria-disabled={loading||disabled} onClick={()=>void load(cursor)} aria-label={`More choices for ${label}`}>{loading?'Loading…':'More choices'}</button>}
  </div>;
}
