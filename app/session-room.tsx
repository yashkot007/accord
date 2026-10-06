'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { clientRequest } from '@/lib/client-request';
import './session-room.css';

type Session = { id: string; name: string; purpose: string; owner_id: string };
type View = 'start' | 'join' | null;
type Bootstrap = { spaces: Session[]; pages:{spaces:{next_cursor:string|null}} };

export default function SessionRoom() {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const [view, setView] = useState<View>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionCursor,setSessionCursor]=useState<string|null>(null),paging=useRef(false),pageFocus=useRef<{id:string;trigger:Element|null}|null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState<{ id: string; view: 'start' | 'join' } | null>(null);
  const creating = useRef<{ signature: string; id: string } | null>(null);
  const bootstrap = useRef<Promise<Bootstrap> | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const listRequest = useRef(0);
  const working = busy || navigating;

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
      if (request === listRequest.current){setSessions(account.spaces);setSessionCursor(account.pages.spaces.next_cursor);}
    } catch (e) {
      if (request === listRequest.current) setError((e as Error).message);
    } finally {
      if (request === listRequest.current) setLoadingSessions(false);
    }
  }
  useEffect(()=>{if(pageFocus.current){const {id,trigger}=pageFocus.current;if(document.activeElement===trigger||(!trigger?.isConnected&&document.activeElement===document.body))document.getElementById(id)?.focus();pageFocus.current=null;}},[sessions]);
  async function moreSessions(){
    if(!sessionCursor||paging.current)return;paging.current=true;const request=listRequest.current,trigger=document.activeElement;setLoadingSessions(true);setError('');
    try{const page=await clientRequest(`/api/workspace?catalog=spaces&cursor=${encodeURIComponent(sessionCursor)}`);if(request!==listRequest.current)return;
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

  async function enter(id: string) {
    // Check membership before navigating; the room rechecks access on every read.
    await clientRequest(`/api/workspace?space=${encodeURIComponent(id)}&header=yes`);
    listRequest.current++;
    setLoadingSessions(false);
    setError('');
    setNavigating(true);
    router.push(`/sessions/${encodeURIComponent(id)}`);
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
          <label htmlFor="session-name">Session name<Input id="session-name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="A little space to think together" disabled={working || saved?.view === 'start'} autoComplete="off" /></label>
          <label htmlFor="session-purpose">What are you working on?<Textarea id="session-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} required maxLength={2000} rows={3} placeholder="The purpose of this session" disabled={working || saved?.view === 'start'} /></label>
          {saved?.view === 'start' && !working && <p className="accord-feedback" role="status">Your session is saved. Retry opening it below.</p>}
          <Button className="accord-button accord-button-primary accord-submit" disabled={working}>{working ? 'Opening…' : saved?.view === 'start' ? 'Open saved session' : 'Start session'}</Button>
        </form>}

        {view === 'join' && <>
          {loadingSessions && <p className="accord-feedback" role="status">Finding your sessions…</p>}
          {sessions.length > 0 && <div className="accord-existing" aria-label="Your sessions">
            {sessions.map(item => <Button key={item.id} id={`session-${item.id}`} className="accord-session-row" disabled={working} onClick={() => void perform(() => enter(item.id))}>{item.name}</Button>)}
          </div>}
          {sessionCursor&&<Button className="accord-session-row" disabled={working||loadingSessions} onClick={()=>void moreSessions()}>{loadingSessions?'Loading…':'More sessions'}</Button>}
          <form className="accord-form" onSubmit={join}>
            <label htmlFor="invitation-code">Invitation code<Input id="invitation-code" value={code} onChange={e => setCode(e.target.value)} required maxLength={150} placeholder="Paste your invitation code" disabled={working || saved?.view === 'join'} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
            {saved?.view === 'join' && !working && <p className="accord-feedback" role="status">You joined. Retry opening your session below.</p>}
            <Button className="accord-button accord-button-primary accord-submit" disabled={working}>{working ? 'Opening…' : saved?.view === 'join' ? 'Open saved session' : 'Join session'}</Button>
          </form>
        </>}

        {error && <p className="accord-error" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
