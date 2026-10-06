'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { clientRequest, RequestFailure } from '@/lib/client-request';
import { assistantFor, assistants, museConnectionRequest, verificationPrompt } from '@/lib/assistant-connections';
import { AssistantInstallGuide } from './assistant-setup-dialog';
import './agent-connection-dialog.css';
import { PixelAgentIcon } from './pixel-agent-icon';
import { PagedSelect } from './paged-select';

type AgentProfile = {
  id: string;
  owner_id: string;
  name: string;
  provider: string;
  status: string;
  last_seen_at?: string | null;
  contact_version: number;
};
type ConnectionState = { user:{id:string};profile?:AgentProfile;attached?:boolean;has_profiles?:boolean };
type Props = { spaceId?: string; initialProfileId?: string; userId: string; onClose: () => void; onAttached: () => void };
type Creation = { signature: string; requestId: string; profileId?: string };
type CopyTarget = 'setup' | 'instructions';
type CopyFeedback = { kind: 'copied' | 'manual'; target: CopyTarget; message: string };

function contactTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function defaultAssistantName(provider: string) {
  const assistant = assistantFor(provider);
  return assistant.id === 'other' ? 'My assistant' : assistant.id === 'openai' ? 'My OpenAI assistant' : assistant.id === 'muse' ? 'My Muse' : `My ${assistant.name}`;
}

export function AgentConnectionDialog({ spaceId, initialProfileId, userId, onClose, onAttached }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const instructionsField = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const installation = useRef<HTMLDivElement>(null), setupField = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false), revision = useRef(0), writing = useRef(false);
  const copyPending = useRef(false);
  const creation = useRef<Creation | null>(null);
  const setup = useRef<{ profileId: string; baseline: string | null; baselineVersion: number } | null>(null);
  const [hasProfiles,setHasProfiles]=useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedId, setSelectedId] = useState(initialProfileId || '');
  const [selectionRevision,setSelectionRevision]=useState(0);
  const [name, setName] = useState(''), [provider, setProvider] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(false), [error, setError] = useState('');
  const [contact, setContact] = useState<string | null>(null);
  const [copied, setCopied] = useState(false), [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [copying,setCopying]=useState<CopyTarget | null>(null);
  const [setupFallback, setSetupFallback] = useState('');
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const current = (value: number) => mounted.current && revision.current === value;
  const close = () => { if (!writing.current) onClose(); };

  useEffect(() => {
    if (step !== 2) return;
    const next = installation.current?.querySelector<HTMLElement>('a[href], button:not([disabled])') || installation.current?.querySelector<HTMLElement>('h3');
    (next || copyButton.current)?.focus();
  }, [step]);
  useEffect(() => { if (instructionsOpen) instructionsField.current?.focus(); }, [instructionsOpen]);
  useEffect(() => {
    if(copyFeedback?.kind!=='manual')return;
    const field=copyFeedback.target==='setup'?setupField.current:instructionsField.current;
    field?.focus();field?.select();
  }, [copyFeedback]);

  async function freshState(profileId?:string) {
    const params=new URLSearchParams();if(spaceId)params.set('space',spaceId);if(profileId)params.set('profile',profileId);else params.set('setup','yes');
    const state=await clientRequest(`/api/workspace?${params}`) as ConnectionState;
    if(state.user.id!==userId)throw new RequestFailure('Your signed-in account changed. Reopen assistant setup before continuing.',403);
    return state;
  }

  async function loadOptions(profileId?:string) {
    const request = ++revision.current;
    setLoading(true); setError(''); setAccess(false); setContact(null);setCopied(false);setCopyFeedback(null);setSetupFallback('');
    try {
      const state=await freshState();
      if (!current(request)) return;
      setHasProfiles(!!state.has_profiles);if(!state.has_profiles)setMode('new');
      if(profileId){
        const checked=await freshState(profileId);if(!current(request))return;
        const candidate=validateProfile(checked,false);
        setMode('existing');setSelectedId(candidate.id);
        if(!spaceId||checked.attached){
          setup.current={profileId:candidate.id,baseline:candidate.last_seen_at||null,baselineVersion:candidate.contact_version};
          recordContact(candidate);setStep(2);
        }
      }
      setAccess(true);
    } catch (failure) {
      if (current(request)) { setHasProfiles(false); setError((failure as Error).message); }
    } finally {
      if (current(request)) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.current?.open) dialog.current?.showModal();
    void loadOptions(initialProfileId);
    return () => {
      mounted.current = false; revision.current++;
      queueMicrotask(() => {
        if (document.querySelector('dialog[open]')) return;
        if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
        else {
          const heading = document.querySelector<HTMLElement>('#workspace-main h1') || document.getElementById('workspace-main');
          if (heading) { heading.tabIndex = -1; heading.focus(); }
        }
      });
    };
  // The parent mounts a fresh dialog for each account, location and selected assistant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, userId, initialProfileId]);

  function validateProfile(state:ConnectionState,requireAttachment=!!spaceId) {
    const profile=state.profile;
    if(!profile||profile.owner_id!==userId||profile.status==='revoked'||requireAttachment&&!state.attached)throw new RequestFailure(spaceId?'This assistant is no longer available in this room. Choose another assistant or review your access.':'This assistant is no longer available to your account. Choose another assistant.',403);
    return profile;
  }

  function recordContact(agent: AgentProfile) {
    const seen = agent.last_seen_at || null;
    // The server contact counter remains reliable when timestamps tie or clocks move backward.
    const newer = seen && agent.contact_version > (setup.current?.baselineVersion ?? agent.contact_version);
    setProfile(agent); setContact(newer ? seen : null);
  }

  async function attach(event: React.FormEvent) {
    event.preventDefault();
    if (writing.current || loading || !access) return;
    if (mode === 'new' && !provider.trim()) return;
    if (mode === 'existing' && !selectedId) return;
    writing.current = true;
    const request = ++revision.current;
    setBusy(true); setError(''); setCopyFeedback(null);
    try {
      // Recheck the account and, when present, room access before either write.
      await freshState();
      if (!current(request)) return;
      let profileId = selectedId;
      if (mode === 'new') {
        const payload = { name: name.trim() || defaultAssistantName(provider), provider: provider.trim() };
        const signature = JSON.stringify(payload);
        if (creation.current?.signature !== signature) creation.current = { signature, requestId: crypto.randomUUID() };
        const retry = creation.current;
        if (!retry.profileId) {
          const receipt = await clientRequest('/api/workspace', 'add_agent', { ...payload, request_id: retry.requestId });
          // Keep the returned ID before attachment, including when attachment fails.
          retry.profileId = receipt.id as string;
          if (!current(request)) return;
          setCreatedId(retry.profileId);
        }
        profileId = retry.profileId;
      }
      const checked=await freshState(profileId);if(!current(request))return;
      const candidate=validateProfile(checked,false);
      if (setup.current?.profileId !== profileId) setup.current = { profileId, baseline: candidate.last_seen_at || null, baselineVersion: candidate.contact_version };
      if(spaceId)await clientRequest('/api/workspace', 'attach_agent', { space_id: spaceId, agent_id: profileId });
      if (!current(request)) return;
      const state = await freshState(profileId);
      if (!current(request)) return;
      recordContact(validateProfile(state));
      setAccess(true); setStep(2); setCopied(false); onAttached();
    } catch (failure) {
      if (current(request)) {
        setError((failure as Error).message);
        if (failure instanceof RequestFailure && failure.status === 403) { setAccess(false); setContact(null); setProfile(null); }
      }
    } finally {
      writing.current = false;
      if (current(request)) setBusy(false);
    }
  }

  function chooseAnother() {
    if(writing.current||loading)return;
    creation.current=null;setup.current=null;
    setCreatedId(null);setProfile(null);setSelectedId('');setProvider('');setName('');setStep(1);setMode('existing');setContact(null);
    setCopied(false);setCopyFeedback(null);setSetupFallback('');setInstructionsOpen(false);setSelectionRevision(value=>value+1);
    void loadOptions();
  }

  async function checkContact() {
    if (writing.current || loading || !setup.current) return;
    const request = ++revision.current;
    setLoading(true); setError(''); setAccess(false); setContact(null);setCopied(false);setCopyFeedback(null);setSetupFallback('');
    try {
      const state = await freshState(setup.current.profileId);
      if (!current(request)) return;
      recordContact(validateProfile(state));
      setAccess(true); onAttached();
    } catch (failure) {
      if (current(request)) { setProfile(null); setError((failure as Error).message); }
    } finally {
      if (current(request)) setLoading(false);
    }
  }

  const endpoint = typeof window === 'undefined' ? '' : `${window.location.origin}/mcp`;
  const recipe = profile ? assistantFor(profile.provider) : null;
  const instructions = profile ? recipe?.id === 'muse' ? museConnectionRequest(endpoint, profile, spaceId) : verificationPrompt(profile, spaceId) : '';

  async function copyText(value:string,target:CopyTarget) {
    // Clipboard writes cannot be cancelled. Keep them in order and ignore feedback
    // from an earlier room/account check after its connection revision changes.
    if(copyPending.current||loading||!access||!value)return;
    const request = revision.current;
    copyPending.current=true;setCopying(target);setCopied(false);setCopyFeedback(null);setSetupFallback('');
    try {
      await navigator.clipboard.writeText(value);
      if(current(request)){
        setCopied(target==='instructions');
        setCopyFeedback({kind:'copied',target,message:'Copied. Continue in your assistant.'});
      }
    } catch {
      if(current(request)){
        if(target==='instructions')setInstructionsOpen(true);else setSetupFallback(value);
        setCopyFeedback({kind:'manual',target,message:'Select and copy the text shown here.'});
      }
    }finally{
      copyPending.current=false;
      if(mounted.current)setCopying(null);
    }
  }

  const copyInstructions=()=>copyText(instructions,'instructions');
  const copySetup=(value:string)=>copyText(value,'setup');

  return <dialog ref={dialog} className="agent-connection-dialog" aria-labelledby="agent-connection-title" aria-describedby="agent-connection-description" onCancel={event => {
    if (writing.current) event.preventDefault(); else close();
  }}>
    <div className="dialog-heading"><div><span className="eyebrow">ACCORD · STEP {step} OF 2</span><h2 id="agent-connection-title">{step === 1 ? 'Connect your assistant' : 'Continue in your assistant'}</h2></div><button type="button" className="icon-button" aria-label="Close assistant connection" disabled={busy} onClick={close}><X size={20} /></button></div>
    <p id="agent-connection-description" className="agent-connection-description">{step === 1 ? spaceId ? 'Choose the assistant you want in this room.' : 'Choose the assistant you use.' : 'Finish setup in your assistant, then check its contact here.'}</p>

    {step === 1 && access && <form onSubmit={attach}>
      {hasProfiles && <fieldset className="agent-connection-choice" disabled={busy || loading}><legend className="sr-only">Choose a saved or new assistant</legend><label><input type="radio" name="agent-profile-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Saved assistant</label><label><input type="radio" name="agent-profile-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> Add an assistant</label></fieldset>}
      {mode === 'existing' ? <div className="form-field"><label htmlFor="agent-connection-profile">Your assistant</label><PagedSelect key={selectionRevision} id="agent-connection-profile" label="Your assistant" source={{kind:'agents'}} initialValue={selectedId} disabled={busy||loading} onChange={setSelectedId}/></div> : <><div className="form-field"><label htmlFor="agent-connection-provider">Your assistant</label><select id="agent-connection-provider" value={provider} required disabled={busy || !!createdId} onChange={event => setProvider(event.target.value)}><option value="">Choose your assistant</option>{assistants.map(item => <option key={item.id} value={item.profileProvider}>{item.name}</option>)}</select></div>{provider&&<details className="assistant-name-details"><summary>Name · optional</summary><div className="form-field"><label htmlFor="agent-connection-name">Assistant name</label><input id="agent-connection-name" value={name} maxLength={80} disabled={busy || !!createdId} placeholder={defaultAssistantName(provider)} onChange={event => setName(event.target.value)} /></div></details>}{createdId && <p className="agent-connection-hint">Your assistant is saved. Continue to finish setup.</p>}</>}
      <p className="agent-connection-hint">{spaceId ? 'Your assistant can read what’s shared here. Work permissions are separate.' : 'Choose which rooms to share with your assistant.'}</p>
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy || loading || (mode === 'existing' ? !selectedId : !provider.trim())}>{busy ? 'Preparing…' : 'Continue'}</button></div>
    </form>}

    {step === 2 && profile && access && <><div className="agent-connection-profile"><PixelAgentIcon size={21} /><div><strong>{profile.name}</strong><span>{profile.provider}</span></div><span className="agent-connection-attached">{spaceId ? 'In this room' : 'Saved assistant'}</span></div>
      {recipe?.id !== 'muse' && <div ref={installation}><AssistantInstallGuide recipe={recipe!} endpoint={endpoint} profile={profile} spaceId={spaceId} copyBusy={!!copying} copyingSetup={copying==='setup'} onCopy={value => void copySetup(value)}/></div>}
      {setupFallback && <div className="form-field"><label htmlFor="agent-setup-copy">Select and copy</label><textarea ref={setupField} id="agent-setup-copy" value={setupFallback} readOnly rows={5}/></div>}
      <details className="muse-connection-details"><summary>Connection details</summary><label htmlFor="agent-connection-address">Connection address</label><input id="agent-connection-address" value={endpoint} readOnly/>{recipe?.documentation&&<p><a href={recipe.documentation} target="_blank" rel="noreferrer">Official setup guide</a></p>}{recipe?.packagePath&&recipe.packageKind!=='plugin'&&<p><a href={recipe.packagePath} download>Setup notes</a></p>}<p>Native Claude, Grok Bot and Muse sign-in still needs verification. Use your own Accord sign-in. Contact records activity for this saved assistant; it does not identify the provider or confirm background work.</p></details>
      <section className="agent-connection-instructions" aria-label="Instructions for your assistant"><button ref={copyButton} type="button" className="button primary" aria-disabled={!!copying} onClick={()=>void copyInstructions()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copying==='instructions' ? 'Copying…' : copied ? 'Copied' : recipe?.id === 'muse' ? 'Copy setup instructions' : 'Copy verification prompt'}</button><details className="muse-connection-details" open={instructionsOpen} onToggle={event=>setInstructionsOpen(event.currentTarget.open)}><summary>View instructions</summary><textarea ref={instructionsField} id="agent-connection-instructions" aria-label="Instructions for your assistant" value={instructions} readOnly rows={7} spellCheck={false} /></details>{(copying||copyFeedback)&&<p role="status" className={`agent-connection-feedback ${copying?'':copyFeedback?.kind||''}`}>{copying?'Copying…':copyFeedback?.message}</p>}</section>
      <div className={`agent-connection-contact${contact ? ' received' : ''}`} role="status"><span className="agent-connection-dot" /><div><strong>{contact ? 'Contact received' : 'Waiting for your assistant'}</strong><p>{contact ? contactTime(contact) : setup.current?.baseline ? `Last contact: ${contactTime(setup.current.baseline)}` : 'Copy the instructions, then continue in your assistant.'}</p></div></div>
      <p className="agent-connection-hint">{spaceId ? 'Your assistant will confirm whether it could read this room.' : 'Your assistant will ask which room to use.'}</p>
    </>}

    {step === 2 && <div className="dialog-actions"><button type="button" className="button secondary" aria-disabled={loading} onClick={checkContact}><RefreshCw size={16} />{loading ? 'Checking…' : 'Check contact'}</button><button type="button" className="button primary" onClick={close}>Done</button></div>}

    {loading && <p className="agent-connection-hint" role="status">{step === 1 ? 'Loading your assistants…' : 'Checking access and assistant contact…'}</p>}
    {error && <div className="agent-connection-error" role="alert"><p>{error}</p>{!access && <button type="button" className="text-button" disabled={busy || loading} onClick={()=>void(step === 2 ? checkContact() : loadOptions())}>Try again</button>}{(createdId||selectedId||setup.current)&&<button type="button" className="text-button" disabled={busy || loading} onClick={chooseAnother}>Choose another assistant</button>}</div>}
  </dialog>;
}
