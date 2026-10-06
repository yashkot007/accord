'use client';
import { useEffect,useRef,useState } from 'react';
import { FileText,X } from 'lucide-react';
import { clientRequest,RequestFailure } from '@/lib/client-request';
import { LoadLifecycle } from '@/lib/load-lifecycle';
import { PagedSelect } from './paged-select';
type Row=Record<string,any>;
const path='/api/integrations/granola';
const names:Row={query_granola_meetings:'Find relevant notes',list_meetings:'Browse meetings',get_meetings:'Read selected meetings'};
const label=(value:string)=>value.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());

export function ProviderConnections({spaces,onShared}:{spaces:Row[];onShared:()=>void}){
  const [status,setStatus]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[confirm,setConfirm]=useState(false);
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const lifecycle=useRef(new LoadLifecycle()),writing=useRef(false),retryButton=useRef<HTMLButtonElement>(null),statusAction=useRef<HTMLButtonElement>(null),statusHeading=useRef<HTMLHeadingElement>(null),focusStatus=useRef(false);
  useEffect(()=>{if(!loading&&!loadError&&focusStatus.current){focusStatus.current=false;(statusAction.current&&!statusAction.current.disabled?statusAction.current:statusHeading.current)?.focus();}},[loading,loadError,status]);
  async function refresh(){
    if(writing.current)return;
    return lifecycle.current.load(()=>clientRequest(path),{
      start:()=>{setLoading(true);setError('');},
      success:value=>{focusStatus.current=document.activeElement===retryButton.current;setStatus(value);setLoadError('');},
      failure:failure=>setLoadError((failure as Error).message),
      finish:()=>setLoading(false),
    });
  }
  useEffect(()=>{const scope=lifecycle.current;scope.activate();const current=scope.current();void refresh().then(()=>{if(!current())return;if(new URLSearchParams(window.location.search).get('granola')==='not_connected')setError('Granola sign-in did not complete. Please reconnect; no notes were shared.');if(new URLSearchParams(window.location.search).has('granola'))window.history.replaceState(null,'','/?view=connections');});return()=>scope.deactivate();},[]);
  async function connect(){if(writing.current||loading||loadError)return;writing.current=true;lifecycle.current.invalidate();const current=lifecycle.current.current();setBusy(true);setError('');try{const result=await clientRequest(path,'connect',{});if(current())window.location.assign(result.authorization_url);}catch(e){if(current()){setError((e as Error).message);setBusy(false);}}finally{writing.current=false;}}
  async function disconnect(){if(writing.current||loading||loadError)return;writing.current=true;lifecycle.current.invalidate();const current=lifecycle.current.current();setBusy(true);setError('');try{const result=await clientRequest(path,'disconnect',{});if(current()){setStatus(result);setConfirm(false);}}catch(e){if(current())setError((e as Error).message);}finally{writing.current=false;if(current())setBusy(false);}}
  return <section className="provider-section" aria-label="Account connections">
    <div className="section-heading"><div><h2>Notes</h2></div></div>
    {error&&<p className="error" role="alert">{error}</p>}
    {loadError&&<div className="error" role="alert"><p>{loadError}</p><button ref={retryButton} type="button" className="text-button" aria-disabled={loading||busy} onClick={()=>{if(!busy)void refresh();}}>{loading?'Retrying…':'Retry'}</button></div>}
    <div className="provider-grid">
      <article className="provider-card"><div className="provider-card-heading"><FileText size={22}/><h3 ref={statusHeading} tabIndex={-1}>Granola</h3><span role="status" className={`badge ${!loading&&!loadError&&status?.status==='connected'?'connected':'pending'}`}>{loading?'Checking…':loadError?'Couldn’t check':status?.status==='connected'?'Connected':status?.status==='reauth_required'?'Sign-in needed':'Not connected'}</span></div><p>Find meeting notes privately. Review an excerpt before sharing it with people and agents in a space.</p>{status?.account_label&&<details><summary>Connected account and workspace</summary><pre>{status.account_label}</pre></details>}
        {confirm?<div className="provider-confirm"><p>Disconnect stops future reads and clears Accord’s saved credentials. Shared excerpts remain in their spaces; stop sharing those separately.</p><div className="heading-actions"><button className="button secondary" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button className="button primary" disabled={busy||loading||!!loadError} onClick={disconnect}>{busy?'Disconnecting…':'Disconnect Granola'}</button></div></div>:<div className="heading-actions">{status?.status==='connected'?<><button ref={statusAction} className="button primary" disabled={busy||loading||!!loadError} onClick={()=>setOpen(true)}>Choose notes</button><button className="button quiet" disabled={busy||loading||!!loadError} onClick={connect}>{busy?'Opening Granola…':'Sign in again'}</button><button className="button quiet" disabled={busy||loading||!!loadError} onClick={()=>setConfirm(true)}>Disconnect</button></>:<button ref={statusAction} className="button primary" disabled={busy||loading||!!loadError||!status?.configured} onClick={connect}>{busy?'Opening Granola…':'Connect Granola'}</button>}</div>}
        {status&&!status.configured&&<p className="field-help">Account sign-in is temporarily unavailable.</p>}<p className="field-help">Granola controls note access through your account, plan and active workspace.</p>
      </article>
    </div>
    {open&&<GranolaNotesDialog spaces={spaces} onClose={()=>{setOpen(false);void refresh();}} onShared={()=>{onShared();void refresh();}}/>}
  </section>;
}

export function GranolaNotesDialog({spaces,spaceId,onClose,onShared}:{spaces:Row[];spaceId?:string;onClose:()=>void;onShared:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),[tools,setTools]=useState<Row[]>([]),[toolName,setToolName]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [choosingSpace,setChoosingSpace]=useState(true);
  const [preview,setPreview]=useState<Row|null>(null),[content,setContent]=useState(''),[title,setTitle]=useState('Granola meeting excerpt'),[selectedSpace,setSelectedSpace]=useState(spaceId||''),[result,setResult]=useState<string|null>(null);
  const [catalogProblem,setCatalogProblem]=useState<'failed'|'empty'|'sign-in'|null>(null),[catalogError,setCatalogError]=useState('');
  const lifecycle=useRef(new LoadLifecycle()),writing=useRef(false),retryButton=useRef<HTMLButtonElement>(null),methodField=useRef<HTMLSelectElement>(null),focusMethod=useRef(false);
  const schema=tools.find(t=>t.name===toolName)?.inputSchema;
  const close=()=>{if(!writing.current)onClose();};
  useEffect(()=>{if(!loading&&!catalogProblem&&focusMethod.current){focusMethod.current=false;methodField.current?.focus();}},[loading,catalogProblem,tools]);
  async function loadOptions(){
    if(writing.current)return;
    return lifecycle.current.load(async()=>{const result=await clientRequest(path,'tools',{});if(!Array.isArray(result.tools))throw new Error('Granola could not load its reading options. Try again.');return result.tools as Row[];},{
      start:()=>setLoading(true),
      success:available=>{focusMethod.current=available.length>0&&document.activeElement===retryButton.current;setTools(available);setToolName(previous=>available.some(item=>item.name===previous)?previous:available.find(item=>item.name==='query_granola_meetings')?.name||available[0]?.name||'');setCatalogProblem(available.length?null:'empty');setCatalogError('');},
      failure:failure=>{const signIn=failure instanceof RequestFailure&&failure.status===401;setCatalogProblem(signIn?'sign-in':'failed');setCatalogError(signIn?'Granola needs a new sign-in. Close this window and reconnect it.':(failure as Error).message);},
      finish:()=>setLoading(false),
    });
  }
  useEffect(()=>{const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null,scope=lifecycle.current;ref.current?.showModal();scope.activate();void loadOptions();return()=>{scope.deactivate();queueMicrotask(()=>{if(document.querySelector('dialog[open]'))return;if(trigger?.isConnected){const target=trigger.matches(':disabled')?trigger.closest('.provider-card')?.querySelector<HTMLElement>('h3[tabindex]'):trigger;target?.focus();}});};},[]);
  async function read(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(writing.current||loading)return;writing.current=true;const current=lifecycle.current.current();setBusy(true);setError('');setResult(null);setPreview(null);setContent('');
    const form=new FormData(e.currentTarget),parameters:Row={};
    try{
      for(const [key,s] of Object.entries(schema?.properties||{}) as [string,Row][]){const raw=form.get(key);const type=Array.isArray(s.type)?s.type.find((t:string)=>t!=='null'):s.type;const required=schema?.required?.includes(key);if(raw===null||raw===''&&!required)continue;if(s.enum)parameters[key]=JSON.parse(String(raw));else if(type==='boolean')parameters[key]=raw==='true';else if(type==='number'||type==='integer')parameters[key]=Number(raw);else if(type==='array')parameters[key]=String(raw).split(',').map(v=>v.trim()).filter(Boolean);else parameters[key]=raw;}
      const p=await clientRequest(path,'preview',{tool:toolName,parameters});if(current()){setPreview(p);setContent(p.content);setTitle('Granola meeting excerpt');}
    }catch(e){if(current())setError((e as Error).message);}finally{writing.current=false;if(current())setBusy(false);}
  }
  async function share(e:React.FormEvent){e.preventDefault();if(!preview||writing.current||loading)return;writing.current=true;const current=lifecycle.current.current();setBusy(true);setError('');try{const saved=await clientRequest(path,'share',{draft_id:preview.draft_id,space_id:selectedSpace,title,content});if(current()){setResult(saved.replayed?'Earlier sharing recovered. No duplicate source was created.':'The selected excerpt is now shared with this space.');setPreview(null);setContent('');onShared();}}catch(e){if(current())setError((e as Error).message);}finally{writing.current=false;if(current())setBusy(false);}}
  const supported=schema&&!schema.anyOf&&!schema.oneOf&&!schema.allOf&&Object.values(schema.properties||{}).every((s:any)=>{const type=Array.isArray(s.type)?s.type.find((t:string)=>t!=='null'):s.type;return !s.$ref&&!s.anyOf&&!s.oneOf&&!s.allOf&&(['string','boolean','number','integer'].includes(type)||(type==='array'&&s.items?.type==='string'));});
  return <dialog ref={ref} className="granola-dialog" aria-labelledby="granola-title" onCancel={e=>{if(writing.current)e.preventDefault();else close();}}><div className="dialog-heading"><div><span className="eyebrow">GRANOLA / PRIVATE PREVIEW</span><h2 id="granola-title">Choose what carries forward</h2></div><button className="icon-button" aria-label="Close Granola notes" disabled={busy} onClick={close}><X size={20}/></button></div>
    <p className="dialog-description">Only you can see this preview. Nothing is shared with a relationship until you review the excerpt and confirm its destination.</p>
    {loading&&<p role="status">Loading Granola…</p>}
    {catalogProblem&&<div className={catalogProblem==='failed'?'error':'field-help'} role={catalogProblem==='failed'?'alert':'status'}><p>{catalogProblem==='empty'?'No reading options are available from Granola right now.':catalogError}</p>{catalogProblem!=='sign-in'&&<button ref={retryButton} type="button" className="text-button" aria-disabled={loading||busy} onClick={()=>{if(!busy)void loadOptions();}}>{loading?'Retrying…':'Retry'}</button>}</div>}
    {!loading&&tools.length>0?<form onSubmit={read} className="granola-search"><div className="form-field"><label htmlFor="granola-method">Read your notes</label><select ref={methodField} id="granola-method" disabled={busy} value={toolName} onChange={e=>{setToolName(e.target.value);setPreview(null);setContent('');setError('');}}>{tools.map(t=><option value={t.name} key={t.name}>{names[t.name]||t.name}</option>)}</select></div>
      {supported?Object.entries(schema.properties||{}).map(([key,s]:[string,any])=>{const type=Array.isArray(s.type)?s.type.find((t:string)=>t!=='null'):s.type;const required=schema.required?.includes(key);return <div className="form-field" key={toolName+key}><label htmlFor={'granola-'+key}>{s.title||label(key)}{!required&&<span> · optional</span>}</label>{s.enum?<select id={'granola-'+key} name={key} required={required} disabled={busy} defaultValue={s.default!==undefined?JSON.stringify(s.default):''}><option value="">Choose one</option>{s.enum.map((value:any)=><option key={JSON.stringify(value)} value={JSON.stringify(value)}>{String(value)}</option>)}</select>:type==='boolean'?<select id={'granola-'+key} name={key} disabled={busy} required={required} defaultValue={s.default!==undefined?String(s.default):''}><option value="">Choose one</option><option value="true">Yes</option><option value="false">No</option></select>:<input id={'granola-'+key} name={key} disabled={busy} required={required} type={type==='number'||type==='integer'?'number':'text'} step={type==='integer'?1:'any'} min={s.minimum} max={s.maximum} maxLength={Math.min(s.maxLength||2000,2000)} defaultValue={s.default===undefined?'':type==='array'?s.default.join(', '):String(s.default)}/>}<p className="field-help">{s.description}{type==='array'?' Separate values with commas.':''}</p></div>;}):<p className="field-help">This Granola tool uses filters Accord does not yet support. Choose another reading method.</p>}
      <button className="button secondary" disabled={busy||!supported}>{busy?'Reading…':'Preview notes'}</button></form>:null}
    {error&&<p className="error" role="alert">{error}</p>}{result&&<p className="source-success" role="status">{result}</p>}
    {preview&&<form className="granola-review" onSubmit={share}><h3>Review the excerpt</h3><p className="field-help">Keep only what this relationship needs. Granola search answers may summarize notes; review their wording and citations. This preview expires after 20 minutes.</p><div className="form-field"><label htmlFor="granola-share-space">Share with this space</label><PagedSelect id="granola-share-space" label="Share with this space" source={{kind:'spaces'}} initialValue={selectedSpace} disabled={busy} onChange={setSelectedSpace} onLoading={setChoosingSpace}/></div><div className="form-field"><label htmlFor="granola-excerpt-title">Excerpt title</label><input id="granola-excerpt-title" required maxLength={120} disabled={busy} value={title} onChange={e=>setTitle(e.target.value)}/></div><div className="form-field"><label htmlFor="granola-excerpt">Selected notes to share</label><textarea id="granola-excerpt" rows={9} required maxLength={18500} disabled={busy} value={content} onChange={e=>setContent(e.target.value)}/></div><p className="note">People and agents with access to the selected space can read the saved excerpt. It is an imported copy; edits or removal in Granola do not update it automatically. Guidance still needs a separate review.</p><button className="button primary" disabled={busy||!selectedSpace||choosingSpace}>{busy?'Sharing…':'Share reviewed excerpt'}</button></form>}
    <div className="dialog-actions"><button className="button quiet" disabled={busy} onClick={close}>Close</button></div>
  </dialog>;
}
