import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { clientRequest } from '../lib/client-request.ts';
import { continueSessionAttempt, retainSessionAttempt, sessionAttempt } from '../lib/session-recovery.ts';
import { pair } from './helpers/workspace.mjs';

const draft = { name: '  A fresh perspective  ', purpose: '  Work through this decision  ', code: '' };
const snapshot = db => Object.fromEntries(['spaces', 'members', 'events', 'creation_requests', 'invites'].map(table => [table, db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

// Exercise the actual HTTP route and client transport. Only account resolution is
// replaced by an explicit synthetic resolver; error handling and domain service
// remain the real implementations, with no remote fetch or production binding.
const resolverKey = Symbol.for('accord.synthetic.session-race-resolver');
const workspaceUrl = new URL('../lib/workspace.ts', import.meta.url).href;
const serviceSource = await readFile(new URL('../lib/service.ts', import.meta.url), 'utf8');
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../app/api/workspace/route.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'synthetic-session-account', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)workspace(?:\.ts)?$/ }, () => ({ path: workspaceUrl, external: true }));
    builder.onLoad({ filter: /\/lib\/service\.ts$/ }, () => ({ loader: 'ts', contents: `import {AppError} from ${JSON.stringify(workspaceUrl)};export async function service(){return globalThis[Symbol.for('accord.synthetic.session-race-resolver')]();}\n${serviceSource.slice(serviceSource.indexOf('export function errorResponse'))}` }));
  } }],
});
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function syntheticTransport(t, workspace) {
  const previousFetch = globalThis.fetch, previousResolver = globalThis[resolverKey];
  globalThis[resolverKey] = () => workspace;
  globalThis.fetch = async (path, init) => {
    const request = new Request(new URL(path, 'https://accord.synthetic'), init);
    if (request.method === 'POST') { request.headers.set('Origin', 'https://accord.synthetic'); return route.POST(request); }
    return route.GET(request);
  };
  t.after(() => { globalThis.fetch = previousFetch; if (previousResolver === undefined) delete globalThis[resolverKey]; else globalThis[resolverKey] = previousResolver; });
}
function forbidSql(workspace) {
  const original = workspace.stmt;
  let calls = 0;
  workspace.stmt = () => { calls++; assert.fail('Account mismatch must reject before domain SQL'); };
  return { get calls() { return calls; }, restore() { workspace.stmt = original; } };
}

test('a lost save reply retries the original request and retains exact input without a duplicate session', async () => {
  const f = await pair();
  try {
    const attempt = sessionAttempt('start', f.a.user.id, draft, 'lost-save-attempt');
    let saved, current, calls = 0;
    const enter = async id => { assert.equal(current.sessionId, id); await f.a.readSpace(id); };
    await assert.rejects(continueSessionAttempt(attempt, f.a.user.id, {
      request: async (action, args) => { calls++; saved = await f.a.human(action, args); throw new Error('Reply lost'); },
      receipt: value => { current = value; }, enter,
    }), /Reply lost/);
    const afterSave = snapshot(f.db);
    assert.equal(attempt.sessionId, undefined);
    assert.deepEqual(attempt.input, draft);
    const retained = retainSessionAttempt([], attempt);
    assert.equal(retained[0].args.request_id, 'lost-save-attempt');
    await continueSessionAttempt(retained[0], f.a.user.id, {
      request: async (action, args) => { calls++; return f.a.human(action, args); },
      receipt: value => { current = value; }, enter,
    });
    assert.equal(current.sessionId, saved.id);
    assert.equal(calls, 2);
    assert.deepEqual(snapshot(f.db), afterSave);
    assert.deepEqual(current.input, draft);
  } finally { f.db.sqlite.close(); }
});

test('a known save is retained before access failure and recovery never recreates lost membership', async () => {
  const f = await pair();
  try {
    const attempt = sessionAttempt('start', f.a.user.id, draft, 'saved-then-removed');
    let current, calls = 0;
    await assert.rejects(continueSessionAttempt(attempt, f.a.user.id, {
      request: async (action, args) => { calls++; return f.a.human(action, args); },
      receipt: value => { current = value; },
      enter: async id => {
        assert.equal(current.sessionId, id);
        f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(id, f.a.user.id);
        await f.a.readSpace(id);
      },
    }), error => error.status === 403);
    const afterRemoval = snapshot(f.db), retained = retainSessionAttempt([], current);
    const alternative = sessionAttempt('start', f.a.user.id, { ...draft, name: 'Another room' }, 'deliberate-new-attempt');
    assert.notEqual(alternative.args.request_id, retained[0].args.request_id);
    assert.deepEqual(retained[0].input, draft);
    await assert.rejects(continueSessionAttempt(retained[0], f.a.user.id, {
      request: async () => { calls++; throw new Error('Must not recreate'); },
      receipt: () => { throw new Error('Already have the receipt'); },
      enter: id => f.a.readSpace(id),
    }), error => error.status === 403);
    assert.equal(calls, 1);
    assert.deepEqual(snapshot(f.db), afterRemoval);
  } finally { f.db.sqlite.close(); }
});

test('a lost join reply retains the original invitation and recovers existing membership only', async () => {
  const f = await pair();
  try {
    f.db.sqlite.prepare('DELETE FROM members WHERE space_id=? AND user_id=?').run(f.space.id, f.b.user.id);
    const invitation = await f.a.human('invite_member', { space_id: f.space.id, email: f.b.user.email, role: 'participant' });
    const input = { name: '', purpose: '', code: ` ${invitation.code} ` };
    const attempt = sessionAttempt('join', f.b.user.id, input, 'original-invitation');
    await assert.rejects(continueSessionAttempt(attempt, f.b.user.id, {
      request: async (action, args) => { await f.b.human(action, args); throw new Error('Reply lost'); },
      receipt: () => { throw new Error('Reply never arrived'); }, enter: () => { throw new Error('Not entered'); },
    }), /Reply lost/);
    const afterJoin = snapshot(f.db);
    let current;
    await continueSessionAttempt(retainSessionAttempt([], attempt)[0], f.b.user.id, {
      request: (action, args) => f.b.human(action, args),
      receipt: value => { current = value; },
      enter: id => f.b.readSpace(id),
    });
    assert.equal(current.sessionId, f.space.id);
    assert.deepEqual(current.input, input);
    assert.equal(current.args.code, invitation.code);
    assert.deepEqual(snapshot(f.db), afterJoin);
  } finally { f.db.sqlite.close(); }
});

test('a changed signed-in account cannot replay or enter an earlier owner’s attempt', async () => {
  for (const view of ['start', 'join']) {
    const attempt = sessionAttempt(view, 'original-owner', { ...draft, code: 'original-code' }, `account-${view}`);
    const events = [];
    await assert.rejects(continueSessionAttempt(attempt, 'another-owner', {
      request: async () => { events.push('request'); return { id: 'room' }; },
      receipt: () => { events.push('receipt'); },
      enter: async () => { events.push('enter'); },
    }), /signed-in account changed/);
    assert.deepEqual(events, []);
    assert.equal(attempt.ownerId, 'original-owner');
  }
});

test('retaining and selecting alternatives keeps all original identities without dispatching', () => {
  const first = sessionAttempt('start', 'owner', draft, 'first');
  const second = sessionAttempt('join', 'owner', { ...draft, code: 'invite' }, 'second');
  const received = { ...first, sessionId: 'saved-room' };
  const earlier = retainSessionAttempt(retainSessionAttempt(retainSessionAttempt([], first), second), received);
  assert.equal(earlier.length, 2);
  assert.equal(earlier.find(item => item.key === 'first').sessionId, 'saved-room');
  assert.equal(earlier.find(item => item.key === 'first').args.request_id, 'first');
  assert.deepEqual(earlier.find(item => item.key === 'second').input, second.input);
  assert.equal(first.sessionId, undefined);
  assert.throws(() => { first.args.request_id = 'replacement'; }, TypeError);
  assert.throws(() => { first.input.name = 'replacement'; }, TypeError);
});

test('the real client and POST route reject an account switch after bootstrap for start and join', async t => {
  const f = await pair(); t.after(() => f.db.sqlite.close()); syntheticTransport(t, f.b);
  const anotherRoom = await f.a.human('create_space', { name: 'Invitation destination', topic: 'Synthetic', purpose: 'Synthetic race' });
  const invitation = await f.a.human('invite_member', { space_id: anotherRoom.id, email: f.b.user.email, role: 'participant' });
  const before = snapshot(f.db), sql = forbidSql(f.b); t.after(() => sql.restore());
  for (const view of ['start', 'join']) {
    // The bootstrap observed A; the next authenticated request resolves B.
    const attempt = sessionAttempt(view, f.a.user.id, { ...draft, code: invitation.code }, `after-bootstrap-${view}`);
    await assert.rejects(continueSessionAttempt(attempt, f.a.user.id, {
      request: (action, args) => clientRequest('/api/workspace', action, args),
      receipt: () => assert.fail('Wrong-account save must not produce a receipt'),
      enter: async () => assert.fail('Wrong-account save must not navigate'),
    }), error => error.status === 403 && /signed-in account changed/.test(error.message));
    assert.equal(attempt.sessionId, undefined);
  }
  assert.equal(sql.calls, 0); assert.deepEqual(snapshot(f.db), before);
  assert.equal(f.db.sqlite.prepare('SELECT used_by FROM invites WHERE space_id=?').get(anotherRoom.id).used_by, null);
});

test('the real GET header pin blocks a known-room open after account switch before SQL or navigation', async t => {
  const f = await pair(); t.after(() => f.db.sqlite.close()); syntheticTransport(t, f.b);
  assert.equal((await f.b.member(f.space.id)).id, f.space.id, 'B ordinarily has access to this shared room');
  const attempt = { ...sessionAttempt('start', f.a.user.id, draft, 'known-room-owner'), sessionId: f.space.id };
  const before = snapshot(f.db), sql = forbidSql(f.b); t.after(() => sql.restore());
  let navigation = 0;
  await assert.rejects(continueSessionAttempt(attempt, f.a.user.id, {
    request: async () => assert.fail('A known receipt must not repeat the save'),
    receipt: () => assert.fail('A known receipt remains unchanged'),
    enter: async (id, expectedOwnerId) => {
      assert.equal(expectedOwnerId, f.a.user.id);
      await clientRequest(`/api/workspace?space=${encodeURIComponent(id)}&header=yes`, undefined, undefined, { expectedOwnerId });
      navigation++;
    },
  }), error => error.status === 403);
  assert.equal(sql.calls, 0); assert.equal(navigation, 0); assert.deepEqual(snapshot(f.db), before);
});

test('HTTP owner headers are optional preconditions for both methods and never override the actor', async t => {
  const f = await pair(); t.after(() => f.db.sqlite.close()); syntheticTransport(t, f.b);
  const args = { name: 'Legacy client', topic: 'Synthetic', purpose: 'Still works', request_id: 'legacy-client-request' };
  const created = await clientRequest('/api/workspace', 'create_space', args);
  const matching = await clientRequest('/api/workspace', 'create_space', { ...args, expected_owner_id: f.b.user.id }, { expectedOwnerId: f.b.user.id });
  assert.equal(matching.id, created.id);
  assert.equal((await clientRequest(`/api/workspace?space=${created.id}&header=yes`)).user.id, f.b.user.id);
  assert.equal((await clientRequest(`/api/workspace?space=${created.id}&header=yes`, undefined, undefined, { expectedOwnerId: f.b.user.id })).room.owner_id, f.b.user.id);
  const before = snapshot(f.db), sql = forbidSql(f.b); t.after(() => sql.restore());
  for (const [header, bodyOwner, status] of [[f.a.user.id, f.b.user.id, 403], [f.b.user.id, f.a.user.id, 403], ['', f.b.user.id, 400]]) {
    await assert.rejects(clientRequest('/api/workspace', 'create_space', { ...args, expected_owner_id: bodyOwner }, { expectedOwnerId: header }), error => error.status === status);
  }
  await assert.rejects(clientRequest(`/api/workspace?space=${created.id}&header=yes`, undefined, undefined, { expectedOwnerId: '' }), error => error.status === 400);
  assert.equal(sql.calls, 0); assert.deepEqual(snapshot(f.db), before);
});
