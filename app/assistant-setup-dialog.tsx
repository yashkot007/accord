'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { assistantFor, assistants, museConnectionRequest, verificationPrompt, type AssistantId, type AssistantRecipe, type SetupProfile } from '@/lib/assistant-connections';
import { PagedSelect } from './paged-select';
import { clientRequest } from '@/lib/client-request';

export function AssistantInstallGuide({ recipe, endpoint, onCopy, profile, spaceId }: {
  recipe: AssistantRecipe; endpoint: string; onCopy: (value: string) => void; profile?: SetupProfile; spaceId?: string;
}) {
  return <section className="muse-setup-step" aria-label={`Add Accord to ${recipe.name}`}>
    <h3>Add Accord to {recipe.name}</h3><p>{recipe.instruction}</p>
    {recipe.method === 'plugin' ? <a className="button secondary" href={recipe.packagePath} download><Download size={15}/>Download plugin</a>
      : recipe.method === 'custom-connector' ? <button className="button secondary" onClick={() => onCopy(museConnectionRequest(endpoint, profile, spaceId))}><Copy size={15}/>Copy setup instructions</button>
      : recipe.method !== 'existing-plugin' && <button className="button secondary" onClick={() => onCopy(endpoint)}><Copy size={15}/>Copy connection address</button>}
    {recipe.method === 'unconfirmed' && <p className="field-help">Stop if your assistant does not offer this connection.</p>}
  </section>;
}

export function AssistantSetupDialog({ agents, userId, initialProfileId = '', onClose, onCreateProfile }: {
  agents: SetupProfile[]; userId: string; initialProfileId?: string; onClose: () => void; onCreateProfile: (provider: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = agents.find(agent => agent.id === initialProfileId && agent.owner_id === userId && agent.status !== 'revoked');
  const [assistantId, setAssistantId] = useState<AssistantId | ''>(initial ? assistantFor(initial.provider).id : '');
  const [profileId, setProfileId] = useState(initial?.id || '');
  const [selectedProfile,setSelectedProfile]=useState<SetupProfile|undefined>(initial),[loadError,setLoadError]=useState('');
  const [loadingInitial,setLoadingInitial]=useState(!!initialProfileId&&!initial);
  const [copied, setCopied] = useState(false), [fallback, setFallback] = useState('');
  const recipe = assistants.find(item => item.id === assistantId);
  const profile = selectedProfile;
  const endpoint = typeof window === 'undefined' ? '' : `${window.location.origin}/mcp`;
  const prompt = profile ? verificationPrompt(profile) : '';
  useEffect(()=>{let current=true;if(initialProfileId&&!initial){setLoadingInitial(true);void clientRequest(`/api/workspace?profile=${encodeURIComponent(initialProfileId)}`).then(result=>{if(result.user.id!==userId)throw new Error('Your account changed. Reopen assistant setup.');if(current){setSelectedProfile(result.profile);setProfileId(result.profile.id);setAssistantId(assistantFor(result.profile.provider).id);}}).catch(error=>{if(current)setLoadError(error.message);}).finally(()=>{if(current)setLoadingInitial(false);});}return()=>{current=false;};},[initialProfileId,userId]);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => queueMicrotask(() => {
      if (document.querySelector('dialog[open]')) return;
      if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
      else document.getElementById('workspace-main')?.focus();
    });
  }, []);

  async function copy(value: string) {
    setCopied(false); setFallback('');
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { setFallback(value); }
  }

  return <dialog ref={dialog} className="muse-dialog" aria-labelledby="assistant-setup-title" aria-describedby="assistant-setup-description" onCancel={onClose}>
    <div className="dialog-heading"><div><span className="eyebrow">ACCORD</span><h2 id="assistant-setup-title">Connect your assistant</h2></div><button className="icon-button" aria-label="Close assistant setup" onClick={onClose}><X size={20}/></button></div>
    <p id="assistant-setup-description" className="dialog-description">Choose the assistant you use. Your rooms and permissions stay in Accord.</p>
    {loadError&&<p className="error" role="alert">{loadError}</p>}
    {loadingInitial&&<p className="field-help" role="status">Loading your assistant…</p>}
    <div className="form-field"><label htmlFor="assistant-provider">Your assistant</label><select id="assistant-provider" value={assistantId} disabled={loadingInitial} onChange={event => { setAssistantId(event.target.value as AssistantId | ''); setProfileId('');setSelectedProfile(undefined); setCopied(false); setFallback('');setLoadError(''); }}><option value="">Choose your assistant</option>{assistants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    {recipe && <><section className="muse-setup-step" aria-label="Choose an assistant in Accord"><h3>In Accord</h3>
      <div className="form-field"><label htmlFor="assistant-profile">Saved assistant</label><PagedSelect key={assistantId} id="assistant-profile" label="Saved assistant" source={{kind:'agents'}} initialValue={profileId} onSelected={item=>{setProfileId(item?.id||'');setSelectedProfile(item as SetupProfile|undefined);setCopied(false);setFallback('');}}/></div>
      <button className="button quiet" onClick={() => onCreateProfile(recipe.profileProvider)}>Add an assistant</button>
    </section>
    <AssistantInstallGuide recipe={recipe} endpoint={endpoint} profile={profile} onCopy={value => void copy(value)}/>
    {profile && recipe.id !== 'muse' && <section className="muse-setup-step"><h3>Confirm the connection</h3><p>After adding Accord, send this prompt to your assistant.</p><button className="button primary" onClick={() => void copy(prompt)}><Copy size={15}/>Copy verification prompt</button></section>}
    {copied && <p role="status" className="source-success">Copied. Continue in your assistant.</p>}
    {fallback && <div className="form-field"><label htmlFor="assistant-copy-fallback">Select and copy</label><textarea id="assistant-copy-fallback" value={fallback} readOnly autoFocus onFocus={event=>event.target.select()} rows={6}/></div>}
    <details className="muse-connection-details"><summary>Connection details</summary><p>One authenticated MCP service is shared by compatible assistants. Installation alone does not confirm a connection. Native Claude, Grok Bot and Muse authorization still needs verification.</p><label className="small-label" htmlFor="assistant-endpoint">Connection address</label><input id="assistant-endpoint" value={endpoint} readOnly/>{recipe.documentation && <p><a href={recipe.documentation} target="_blank" rel="noreferrer">Official setup guide</a></p>}{recipe.packagePath && <p><a href={recipe.packagePath} download>{recipe.packageKind === 'plugin' ? 'Plugin package' : recipe.packageKind === 'marketplace-candidate' ? 'Marketplace candidate and setup notes' : 'Custom connector setup packet'}</a></p>}<p className="field-help">Use your own Accord sign-in. A profile records activity through that account; it is not a separate credential or proof of the caller’s provider. Assistants check in when invoked. Permissions and guidance decisions remain yours.</p></details></>}
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>Done</button></div>
  </dialog>;
}
