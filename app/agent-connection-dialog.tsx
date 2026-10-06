'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, RefreshCw, X } from 'lucide-react';
import { clientRequest, RequestFailure } from '@/lib/client-request';
import { assistantFor, assistants, museConnectionRequest, verificationPrompt } from '@/lib/assistant-connections';
import { AssistantInstallGuide } from './assistant-setup-dialog';
import './agent-connection-dialog.css';
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
type Props = { spaceId: string; userId: string; onClose: () => void; onAttached: () => void };
type Creation = { signature: string; requestId: string; profileId?: string };

function contactTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export function AgentConnectionDialog({ spaceId, userId, onClose, onAttached }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const instructionsField = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false), revision = useRef(0), writing = useRef(false);
  const creation = useRef<Creation | null>(null);
  const setup = useRef<{ profileId: string; baseline: string | null; baselineVersion: number } | null>(null);
  const [hasProfiles,setHasProfiles]=useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState(''), [provider, setProvider] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(false), [error, setError] = useState('');
  const [contact, setContact] = useState<string | null>(null);
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const [setupFallback, setSetupFallback] = useState('');
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const current = (value: number) => mounted.current && revision.current === value;
  const close = () => { if (!writing.current) onClose(); };

  useEffect(() => { if (step === 2) copyButton.current?.focus(); }, [step]);
  useEffect(() => { if (instructionsOpen) instructionsField.current?.focus(); }, [instructionsOpen]);

  async function freshState(profileId?:string) {
    const params=new URLSearchParams({space:spaceId});if(profileId)params.set('profile',profileId);else params.set('setup','yes');
    const state=await clientRequest(`/api/workspace?${params}`) as ConnectionState;
    if(state.user.id!==userId)throw new RequestFailure('Your signed-in account changed. Reopen this room before connecting an agent.',403);
    return state;
  }

  async function loadOptions() {
    const request = ++revision.current;
    setLoading(true); setError(''); setAccess(false); setContact(null);
    try {
      const state=await freshState();
      if (!current(request)) return;
      setHasProfiles(!!state.has_profiles);if(!state.has_profiles)setMode('new');
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
    void loadOptions();
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
  // This dialog is mounted for one room and account by its parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, userId]);

  function validateProfile(state:ConnectionState) {
    const profile=state.profile;
    if(!profile||profile.owner_id!==userId||profile.status==='revoked'||!state.attached)throw new RequestFailure('This profile is no longer available in this room. Review your agent settings before continuing.',403);
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
    if (mode === 'new' && (!name.trim() || !provider.trim())) return;
    if (mode === 'existing' && !selectedId) return;
    writing.current = true;
    const request = ++revision.current;
    setBusy(true); setError(''); setCopyError('');
    try {
      // Recheck account and room access before either write.
      await freshState();
      if (!current(request)) return;
      let profileId = selectedId;
      if (mode === 'new') {
        const payload = { name: name.trim(), provider: provider.trim() };
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
      const candidate=checked.profile;
      if(!candidate||candidate.owner_id!==userId||candidate.status==='revoked')throw new RequestFailure('Choose an available profile owned by your account.',403);
      if (setup.current?.profileId !== profileId) setup.current = { profileId, baseline: candidate.last_seen_at || null, baselineVersion: candidate.contact_version };
      await clientRequest('/api/workspace', 'attach_agent', { space_id: spaceId, agent_id: profileId });
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

  async function checkContact() {
    if (writing.current || loading || !setup.current) return;
    const request = ++revision.current;
    setLoading(true); setError(''); setAccess(false); setContact(null);
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

  async function copyInstructions() {
    const request = revision.current;
    setCopyError('');
    try {
      await navigator.clipboard.writeText(instructions);
      if (current(request)) setCopied(true);
    } catch {
      if (current(request)) { setInstructionsOpen(true); instructionsField.current?.focus(); setCopyError('Select and copy the instructions below.'); }
    }
  }

  async function copySetup(value: string) {
    setCopyError(''); setSetupFallback('');
    try { await navigator.clipboard.writeText(value); setCopied(false); setCopyError('Setup copied. Continue in your assistant.'); }
    catch { setSetupFallback(value); }
  }

  return <dialog ref={dialog} className="agent-connection-dialog" aria-labelledby="agent-connection-title" aria-describedby="agent-connection-description" onCancel={event => {
    if (writing.current) event.preventDefault(); else close();
  }}>
    <div className="dialog-heading"><div><span className="eyebrow">ACCORD · STEP {step} OF 2</span><h2 id="agent-connection-title">{step === 1 ? 'Connect your assistant' : 'Bring your assistant in'}</h2></div><button type="button" className="icon-button" aria-label="Close agent connection" disabled={busy} onClick={close}><X size={20} /></button></div>
    <p id="agent-connection-description" className="agent-connection-description">{step === 1 ? 'Choose the assistant you want in this room.' : 'Finish setup in your assistant, then check its connection here.'}</p>

    {step === 1 && access && <form onSubmit={attach}>
      {hasProfiles && <fieldset className="agent-connection-choice" disabled={busy || loading}><legend className="sr-only">Agent profile type</legend><label><input type="radio" name="agent-profile-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing assistant</label><label><input type="radio" name="agent-profile-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> Add an assistant</label></fieldset>}
      {mode === 'existing' ? <div className="form-field"><label htmlFor="agent-connection-profile">Your agent</label><PagedSelect id="agent-connection-profile" label="Your agent" source={{kind:'agents'}} initialValue={selectedId} disabled={busy||loading} onChange={setSelectedId}/></div> : <><div className="form-field"><label htmlFor="agent-connection-name">Name</label><input id="agent-connection-name" value={name} required maxLength={80} disabled={busy || !!createdId} placeholder="e.g. My thinking partner" onChange={event => setName(event.target.value)} /></div><div className="form-field"><label htmlFor="agent-connection-provider">Your assistant</label><select id="agent-connection-provider" value={provider} required disabled={busy || !!createdId} onChange={event => setProvider(event.target.value)}><option value="">Choose your assistant</option>{assistants.map(item => <option key={item.id} value={item.profileProvider}>{item.name}</option>)}</select></div>{createdId && <p className="agent-connection-hint">Profile saved. Try adding it again.</p>}</>}
      <p className="agent-connection-hint">Your assistant can read what’s shared here. Work permissions are separate.</p>
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy || loading || (mode === 'existing' ? !selectedId : !name.trim() || !provider.trim())}>{busy ? 'Adding agent…' : createdId ? 'Retry adding to room' : 'Add to room'}</button></div>
    </form>}

    {step === 2 && profile && access && <><div className="agent-connection-profile"><Bot size={21} /><div><strong>{profile.name}</strong><span>{profile.provider}</span></div><span className="agent-connection-attached">In this room</span></div>
      {recipe?.id !== 'muse' && <AssistantInstallGuide recipe={recipe!} endpoint={endpoint} profile={profile} spaceId={spaceId} onCopy={value => void copySetup(value)}/>}
      {setupFallback && <div className="form-field"><label htmlFor="agent-setup-copy">Select and copy</label><textarea id="agent-setup-copy" value={setupFallback} readOnly rows={5}/></div>}
      <details className="muse-connection-details"><summary>Connection address</summary><input aria-label="Accord connection address" value={typeof window === 'undefined' ? '' : `${window.location.origin}/mcp`} readOnly/></details>
      <section className="agent-connection-instructions" aria-label="Instructions for your assistant"><button ref={copyButton} type="button" className="button primary" onClick={copyInstructions}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : recipe?.id === 'muse' ? 'Copy setup instructions' : 'Copy verification prompt'}</button><details className="muse-connection-details" open={instructionsOpen} onToggle={event=>setInstructionsOpen(event.currentTarget.open)}><summary>View instructions</summary><textarea ref={instructionsField} id="agent-connection-instructions" aria-label="Instructions for your assistant" value={instructions} readOnly rows={7} spellCheck={false} /></details>{copyError && <p role="status" className="agent-connection-hint">{copyError}</p>}</section>
      <div className={`agent-connection-contact${contact ? ' received' : ''}`} role="status"><span className="agent-connection-dot" /><div><strong>{contact ? 'Contact received' : 'Waiting for your assistant'}</strong><p>{contact ? contactTime(contact) : setup.current?.baseline ? `Last contact: ${contactTime(setup.current.baseline)}` : 'Copy the instructions, then continue in your assistant.'}</p></div></div>
      <p className="agent-connection-hint">Your assistant will confirm whether it could read this room.</p>
    </>}

    {step === 2 && <div className="dialog-actions"><button type="button" className="button secondary" disabled={loading} onClick={checkContact}><RefreshCw size={16} />{loading ? 'Checking…' : 'Check contact'}</button><button type="button" className="button primary" onClick={close}>Done</button></div>}

    {loading && <p className="agent-connection-hint" role="status">{step === 1 ? 'Loading your profiles…' : 'Checking current room access and agent contact…'}</p>}
    {error && <div className="agent-connection-error" role="alert"><p>{error}</p>{!access && <button type="button" className="text-button" disabled={busy || loading} onClick={step === 2 ? checkContact : loadOptions}>Review current access</button>}</div>}
  </dialog>;
}
