'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { clientRequest } from '@/lib/client-request';
import './session-room.css';

type Session = { id: string; name: string; purpose: string; owner_id: string };
type View = 'start' | 'join' | 'session' | 'invite' | null;
type Bootstrap = { spaces: Session[] };
type Invitation = { code: string; email: string; expires: string };

export default function SessionRoom({ userId }: { userId: string }) {
  const [view, setView] = useState<View>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<{ id: string; view: 'start' | 'join' } | null>(null);
  const creating = useRef<{ signature: string; id: string } | null>(null);
  const bootstrap = useRef<Promise<Bootstrap> | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const listRequest = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (view === 'session') titleRef.current?.focus();
    if (view === 'invite') document.getElementById(invitation ? 'share-code' : 'invite-email')?.focus();
  }, [view, invitation]);

  function loadAccount(refresh = false) {
    if (refresh) bootstrap.current = null;
    if (!bootstrap.current) {
      bootstrap.current = clientRequest('/api/workspace').then(result => result as Bootstrap).catch(e => {
        bootstrap.current = null;
        throw e;
      });
    }
    return bootstrap.current;
  }

  async function open(view: 'start' | 'join', event: React.MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    setView(view);
    setError('');
    if (view !== 'join') return;
    const request = ++listRequest.current;
    setLoadingSessions(true);
    try {
      const account = await loadAccount(true);
      if (request === listRequest.current) setSessions(account.spaces);
    } catch (e) {
      if (request === listRequest.current) setError((e as Error).message);
    } finally {
      if (request === listRequest.current) setLoadingSessions(false);
    }
  }

  async function perform(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (e) { setError((e as Error).message); }
    finally { running.current = false; setBusy(false); }
  }

  async function enter(id: string) {
    const result = await clientRequest(`/api/workspace?space=${encodeURIComponent(id)}`);
    listRequest.current++;
    setLoadingSessions(false);
    setError('');
    setSession(result as Session);
    setSaved(null);
    creating.current = null;
    setName('');
    setPurpose('');
    setCode('');
    setInvitation(null);
    setView('session');
  }

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await loadAccount();
      let id = saved?.view === 'start' ? saved.id : null;
      if (!id) {
        const args = { name: name.trim(), topic: purpose.trim().slice(0, 80), purpose: purpose.trim() };
        const signature = JSON.stringify(args);
        if (creating.current?.signature !== signature) creating.current = { signature, id: crypto.randomUUID() };
        const result = await clientRequest('/api/workspace', 'create_space', { ...args, request_id: creating.current.id });
        id = result.id as string;
        setSaved({ id, view: 'start' });
      }
      await enter(id);
    });
  }

  function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await loadAccount();
      let id = saved?.view === 'join' ? saved.id : null;
      if (!id) {
        const result = await clientRequest('/api/workspace', 'join_space', { code: code.trim() });
        id = result.id as string;
        setSaved({ id, view: 'join' });
      }
      await enter(id);
    });
  }

  function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    void perform(async () => {
      const result = await clientRequest('/api/workspace', 'invite_member', { space_id: session.id, email: email.trim(), role: 'participant' });
      setInvitation(result as Invitation);
      setCopied(false);
    });
  }

  async function copyCode() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.code);
      setCopied(true);
      setError('');
    } catch { setError('Select the invitation code and copy it to share.'); }
  }

  const title = view === 'start' ? 'Start a new session' : view === 'join' ? 'Join a session' : view === 'invite' ? 'Invite someone' : session?.name || 'Your session';
  const description = view === 'start' ? 'Give your session a name and a purpose.' : view === 'join' ? 'Open your session or enter an invitation code.' : view === 'invite' ? 'An invitation for one person, using their sign-in email.' : 'Your session is saved. Come back whenever you need it.';

  return <>
    <main className="accord-room">
      <div className="accord-ambient" aria-hidden="true"><div className="accord-orbit" /><div className="accord-horizon" /></div>
      <section className="accord-welcome" aria-labelledby="accord-welcome-title">
        <h1 id="accord-welcome-title">Welcome to your<br /><span>Accord room.</span></h1>
        <div className="accord-actions">
          <Button className="accord-button accord-button-secondary" onClick={e => void open('join', e)}>Join session</Button>
          <Button className="accord-button accord-button-primary" onClick={e => void open('start', e)}>Start a new session</Button>
        </div>
      </section>
    </main>

    <Dialog open={view !== null} onOpenChange={value => { if (!value && !running.current) { setView(null); listRequest.current++; } }}>
      <DialogContent className="accord-dialog" showCloseButton={!busy} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}>
        <div className="accord-dialog-heading"><DialogTitle ref={titleRef} tabIndex={-1}>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></div>

        {view === 'start' && <form className="accord-form" onSubmit={start}>
          <label htmlFor="session-name">Session name<Input id="session-name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="A little space to think together" disabled={busy || saved?.view === 'start'} autoComplete="off" /></label>
          <label htmlFor="session-purpose">What are you working on?<Textarea id="session-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} required maxLength={2000} rows={3} placeholder="The purpose of this session" disabled={busy || saved?.view === 'start'} /></label>
          {saved?.view === 'start' && <p className="accord-feedback" role="status">Your session is saved. Retry opening it below.</p>}
          <Button className="accord-button accord-button-primary accord-submit" disabled={busy}>{busy ? 'Preparing…' : saved?.view === 'start' ? 'Open saved session' : 'Start session'}</Button>
        </form>}

        {view === 'join' && <>
          {loadingSessions && <p className="accord-feedback" role="status">Finding your sessions…</p>}
          {sessions.length > 0 && <div className="accord-existing" aria-label="Your sessions">
            {sessions.map(item => <Button key={item.id} className="accord-session-row" disabled={busy} onClick={() => void perform(() => enter(item.id))}>{item.name}</Button>)}
          </div>}
          <form className="accord-form" onSubmit={join}>
            <label htmlFor="invitation-code">Invitation code<Input id="invitation-code" value={code} onChange={e => setCode(e.target.value)} required maxLength={150} placeholder="Paste your invitation code" disabled={busy || saved?.view === 'join'} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
            {saved?.view === 'join' && <p className="accord-feedback" role="status">You joined. Retry opening your session below.</p>}
            <Button className="accord-button accord-button-primary accord-submit" disabled={busy}>{busy ? 'Opening…' : saved?.view === 'join' ? 'Open saved session' : 'Join session'}</Button>
          </form>
        </>}

        {view === 'session' && session && <div className="accord-session-ready">
          <p className="accord-purpose">{session.purpose}</p>
          {session.owner_id === userId && <Button className="accord-button accord-button-primary accord-submit" onClick={() => { setView('invite'); setEmail(''); setInvitation(null); setCopied(false); setError(''); }}>Invite someone</Button>}
          <Button className="accord-button accord-button-secondary accord-submit" onClick={() => setView(null)}>Done</Button>
        </div>}

        {view === 'invite' && !invitation && <form className="accord-form" onSubmit={invite}>
          <label htmlFor="invite-email">Their email<Input id="invite-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="person@example.com" disabled={busy} autoComplete="email" /></label>
          <p className="accord-feedback">They’ll also need access to this private app.</p>
          <Button className="accord-button accord-button-primary accord-submit" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</Button>
        </form>}

        {view === 'invite' && invitation && <div className="accord-invitation">
          <p>Share this code with <strong>{invitation.email}</strong>.</p>
          <Input id="share-code" className="accord-code" aria-label="Invitation code to share" value={invitation.code} readOnly onFocus={e => e.target.select()} />
          <p className="accord-feedback">Valid for {invitation.expires}. No email has been sent.</p>
          <Button className="accord-button accord-button-primary accord-submit" onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy invitation code'}</Button>
          <Button className="accord-button accord-button-secondary accord-submit" onClick={() => { setView('session'); setError(''); }}>Back to session</Button>
        </div>}
        {error && <p className="accord-error" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
