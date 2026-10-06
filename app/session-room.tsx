'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { clientRequest, RequestFailure } from '@/lib/client-request';
import { continueSessionAttempt, retainSessionAttempt, sessionAttempt, type SessionAttempt } from '@/lib/session-recovery';
import './session-room.css';

type Session = { id: string; name: string; purpose: string; owner_id: string };
type View = 'start' | 'join' | null;
type Bootstrap = { user: { id: string }; spaces: Session[]; pages:{spaces:{next_cursor:string|null}} };

export default function SessionRoom() {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const [view, setView] = useState<View>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionAccountId, setSessionAccountId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionCursor,setSessionCursor]=useState<string|null>(null),paging=useRef(false),pageFocus=useRef<{id:string;trigger:Element|null}|null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [code, setCode] = useState('');
  const [startAttempt, setStartAttempt] = useState<SessionAttempt | null>(null);
  const [joinAttempt, setJoinAttempt] = useState<SessionAttempt | null>(null);
  const [earlierAttempts, setEarlierAttempts] = useState<SessionAttempt[]>([]);
  const recoveryFocus = useRef<string | null>(null);
  const bootstrap = useRef<Promise<Bootstrap> | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const listRequest = useRef(0);
  const working = busy || navigating;

  useEffect(() => {
    if (!recoveryFocus.current) return;
    document.getElementById(recoveryFocus.current)?.focus();
    recoveryFocus.current = null;
  }, [startAttempt, joinAttempt, earlierAttempts]);

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
    setSessions([]); setSessionCursor(null); setSessionAccountId(null);
    setLoadingSessions(true);
    try {
      const account = await loadAccount(true);
      if (request === listRequest.current){setSessions(account.spaces);setSessionCursor(account.pages.spaces.next_cursor);setSessionAccountId(account.user.id);}
    } catch (e) {
      if (request === listRequest.current) setError((e as Error).message);
    } finally {
      if (request === listRequest.current) setLoadingSessions(false);
    }
  }
  useEffect(()=>{if(pageFocus.current){const {id,trigger}=pageFocus.current;if(document.activeElement===trigger||(!trigger?.isConnected&&document.activeElement===document.body))document.getElementById(id)?.focus();pageFocus.current=null;}},[sessions]);
  async function moreSessions(){
    if(working||loadingSessions||!sessionCursor||!sessionAccountId||paging.current)return;paging.current=true;const request=listRequest.current,trigger=document.activeElement;setLoadingSessions(true);setError('');
    try{const page=await clientRequest(`/api/workspace?catalog=spaces&cursor=${encodeURIComponent(sessionCursor)}`,undefined,undefined,{expectedOwnerId:sessionAccountId});if(request!==listRequest.current)return;
      if(!page.next_cursor&&page.items.length&&document.activeElement===trigger)pageFocus.current={id:`session-${page.items[0].id}`,trigger};
      setSessions(previous=>[...previous,...page.items.filter((item:Session)=>!previous.some(old=>old.id===item.id))]);setSessionCursor(page.next_cursor);
    }catch(error){if(request===listRequest.current)setError((error as Error).message);}
    finally{paging.current=false;if(request===listRequest.current)setLoadingSessions(false);}
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

  async function enter(id: string, expectedOwnerId: string) {
    // Check membership before navigating; the room rechecks access on every read.
    const header=await clientRequest(`/api/workspace?space=${encodeURIComponent(id)}&header=yes`,undefined,undefined,{expectedOwnerId});
    if(header.user.id!==expectedOwnerId)throw new RequestFailure('Your signed-in account changed. Reopen your sessions with this account.',403);
    listRequest.current++;
    setLoadingSessions(false);
    setError('');
    setNavigating(true);
    try { router.push(`/sessions/${encodeURIComponent(id)}`); }
    catch (failure) { setNavigating(false); throw failure; }
  }

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const account = await loadAccount(true);
      const attempt = startAttempt || sessionAttempt('start', account.user.id, { name, purpose, code }, crypto.randomUUID());
      setStartAttempt(attempt);
      await continueSessionAttempt(attempt, account.user.id, {
        request: async (action, args) => await clientRequest('/api/workspace', action, args) as { id: string },
        receipt: setStartAttempt,
        enter,
      });
    });
  }

  function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const account = await loadAccount(true);
      const attempt = joinAttempt || sessionAttempt('join', account.user.id, { name, purpose, code }, crypto.randomUUID());
      setJoinAttempt(attempt);
      await continueSessionAttempt(attempt, account.user.id, {
        request: async (action, args) => await clientRequest('/api/workspace', action, args) as { id: string },
        receipt: setJoinAttempt,
        enter,
      });
    });
  }

  function chooseAnother(kind: 'start' | 'join') {
    if (working || running.current) return;
    const attempt = kind === 'start' ? startAttempt : joinAttempt;
    if (attempt) setEarlierAttempts(previous => retainSessionAttempt(previous, attempt));
    if (kind === 'start') { setStartAttempt(null); setName(''); setPurpose(''); }
    else { setJoinAttempt(null); setCode(''); }
    setError('');
    recoveryFocus.current = kind === 'start' ? 'session-name' : 'invitation-code';
  }

  function resume(attempt: SessionAttempt) {
    if (working || running.current) return;
    const active = attempt.view === 'start' ? startAttempt : joinAttempt;
    setEarlierAttempts(previous => {
      const remaining = previous.filter(item => item.key !== attempt.key);
      return active && active.key !== attempt.key ? retainSessionAttempt(remaining, active) : remaining;
    });
    listRequest.current++;
    setLoadingSessions(false);
    setView(attempt.view); setError('');
    if (attempt.view === 'start') { setStartAttempt(attempt); setName(attempt.input.name); setPurpose(attempt.input.purpose); }
    else { setJoinAttempt(attempt); setCode(attempt.input.code); }
    recoveryFocus.current = 'session-submit';
  }

  const title = view === 'start' ? 'Start a new session' : 'Join a session';
  const description = view === 'start' ? 'Give your session a name and a purpose.' : 'Open your session or enter an invitation code.';

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

    <Dialog open={view !== null} onOpenChange={value => { if (!value && !running.current && !navigating) { setView(null); listRequest.current++; } }}>
      <DialogContent className="accord-dialog" showCloseButton={!working} onEscapeKeyDown={e => { if (working) e.preventDefault(); }} onPointerDownOutside={e => { if (working) e.preventDefault(); }} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}>
        <div className="accord-dialog-heading"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></div>

        {view === 'start' && <form className="accord-form" onSubmit={start}>
          <label htmlFor="session-name">Session name<Input id="session-name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="A little space to think together" disabled={working || !!startAttempt} autoComplete="off" /></label>
          <label htmlFor="session-purpose">What are you working on?<Textarea id="session-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} required maxLength={2000} rows={3} placeholder="The purpose of this session" disabled={working || !!startAttempt} /></label>
          {startAttempt && !working && <p className="accord-feedback" role="status">{startAttempt.sessionId ? 'Your session is saved. Retry opening it below.' : 'A save may have completed. Retry this attempt safely below.'}</p>}
          <Button id="session-submit" className="accord-button accord-button-primary accord-submit" disabled={working}>{working ? 'Opening…' : startAttempt?.sessionId ? 'Open saved session' : startAttempt ? 'Retry start' : 'Start session'}</Button>
          {startAttempt && !working && <><Button type="button" className="accord-button accord-button-secondary accord-submit" onClick={() => chooseAnother('start')}>Start another session</Button><p className="accord-feedback">Choosing another keeps this attempt in this tab. Starting again may create a separate session.</p></>}
        </form>}

        {view === 'join' && <>
          {loadingSessions && <p className="accord-feedback" role="status">Finding your sessions…</p>}
          {sessions.length > 0 && <div className="accord-existing" aria-label="Your sessions">
            {sessions.map(item => <Button key={item.id} id={`session-${item.id}`} className="accord-session-row" disabled={working||!sessionAccountId} onClick={() => {if(sessionAccountId)void perform(() => enter(item.id,sessionAccountId));}}>{item.name}</Button>)}
          </div>}
          {sessionCursor&&<Button className="accord-session-row" disabled={working} aria-disabled={working||loadingSessions} onClick={()=>void moreSessions()}>{loadingSessions?'Loading…':'More sessions'}</Button>}
          <form className="accord-form" onSubmit={join}>
            <label htmlFor="invitation-code">Invitation code<Input id="invitation-code" value={code} onChange={e => setCode(e.target.value)} required maxLength={150} placeholder="Paste your invitation code" disabled={working || !!joinAttempt} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
            {joinAttempt && !working && <p className="accord-feedback" role="status">{joinAttempt.sessionId ? 'You joined. Retry opening your session below.' : 'The invitation may have been accepted. Retry this attempt safely below.'}</p>}
            <Button id="session-submit" className="accord-button accord-button-primary accord-submit" disabled={working}>{working ? 'Opening…' : joinAttempt?.sessionId ? 'Open saved session' : joinAttempt ? 'Retry invitation' : 'Join session'}</Button>
            {joinAttempt && !working && <><Button type="button" className="accord-button accord-button-secondary accord-submit" onClick={() => chooseAnother('join')}>Use another invitation</Button><p className="accord-feedback">Choosing another keeps this attempt in this tab.</p></>}
          </form>
        </>}

        {earlierAttempts.length > 0 && <details className="accord-feedback"><summary>Earlier attempts · {earlierAttempts.length}</summary><p>Kept in this tab. Resume an attempt to review it before retrying.</p><div className="accord-existing">{earlierAttempts.map(attempt => <Button key={attempt.key} type="button" className="accord-session-row" disabled={working} onClick={() => resume(attempt)}>{attempt.view === 'start' ? `Resume ${attempt.input.name}` : 'Resume earlier invitation'}</Button>)}</div></details>}

        {error && <p className="accord-error" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
