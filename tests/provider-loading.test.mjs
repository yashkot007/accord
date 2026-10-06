import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadLifecycle } from '../lib/load-lifecycle.ts';
import { clientRequest } from '../lib/client-request.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function observedState(extra = {}) {
  const state = { loading: false, value: null, error: '', starts: 0, finishes: 0, ...extra };
  return { state, callbacks: {
    start: () => { state.loading = true; state.starts++; },
    success: value => { state.value = value; state.error = ''; },
    failure: error => { state.error = error.message; },
    finish: () => { state.loading = false; state.finishes++; },
  } };
}

test('deferred loading admits one request and does not queue duplicate retries', async () => {
  const lifecycle = new LoadLifecycle(), response = deferred(), view = observedState();
  lifecycle.activate();
  let requests = 0;
  const request = () => { requests++; return response.promise; };
  const pending = lifecycle.load(request, view.callbacks);
  assert.equal(view.state.loading, true);
  for (let count = 0; count < 10; count++) assert.equal(await lifecycle.load(request, view.callbacks), 'pending');
  assert.equal(requests, 1); assert.equal(view.state.starts, 1);
  response.resolve({ status: 'connected' });
  assert.equal(await pending, 'applied');
  assert.equal(view.state.loading, false); assert.equal(view.state.finishes, 1);
  assert.deepEqual(view.state.value, { status: 'connected' }); assert.equal(requests, 1);
});

test('a rejected status read settles loading and only an explicit retry can recover', async t => {
  const previousFetch = globalThis.fetch, first = deferred(), second = deferred();
  let requests = 0;
  globalThis.fetch = () => (++requests === 1 ? first.promise : second.promise);
  t.after(() => { globalThis.fetch = previousFetch; });
  const lifecycle = new LoadLifecycle(), view = observedState(); lifecycle.activate();
  const load = () => lifecycle.load(() => clientRequest('https://accord.synthetic/api/integrations/granola'), view.callbacks);
  const initial = load(); first.reject(new Error('Synthetic interruption'));
  assert.equal(await initial, 'applied');
  assert.equal(view.state.loading, false); assert.match(view.state.error, /interrupted/); assert.equal(requests, 1);
  await Promise.resolve(); assert.equal(requests, 1, 'failure must not automatically retry');
  const retry = load(); assert.equal(view.state.loading, true);
  assert.equal(await load(), 'pending'); assert.equal(requests, 2);
  second.resolve(Response.json({ status: 'connected', configured: true }));
  assert.equal(await retry, 'applied'); assert.equal(view.state.loading, false); assert.equal(view.state.error, '');
  assert.equal(view.state.value.status, 'connected'); assert.equal(requests, 2);
});

test('empty reading options settle, permit explicit recovery, and never replay sharing', async t => {
  const previousFetch = globalThis.fetch, empty = deferred(), ready = deferred(), actions = [];
  globalThis.fetch = async (_path, options) => {
    actions.push(JSON.parse(options.body).action);
    return actions.length === 1 ? empty.promise : ready.promise;
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const lifecycle = new LoadLifecycle(), view = observedState({
    preview: { draft_id: 'reviewed-draft' }, content: 'Keep this edited excerpt', title: 'Edited title',
    destination: 'reviewed-room', receipt: 'Earlier sharing recovered',
  }); lifecycle.activate();
  const reviewBefore = { ...view.state };
  const load = () => lifecycle.load(() => clientRequest('https://accord.synthetic/api/integrations/granola', 'tools', {}), view.callbacks);
  const initial = load(); empty.resolve(Response.json({ tools: [] }));
  assert.equal(await initial, 'applied'); assert.equal(view.state.loading, false); assert.deepEqual(view.state.value.tools, []);
  assert.deepEqual(actions, ['tools']);
  const retry = load(); assert.equal(await load(), 'pending');
  ready.resolve(Response.json({ tools: [{ name: 'query_granola_meetings', inputSchema: { type: 'object', properties: {} } }] }));
  assert.equal(await retry, 'applied'); assert.equal(view.state.value.tools.length, 1);
  for (const key of ['preview', 'content', 'title', 'destination', 'receipt']) assert.deepEqual(view.state[key], reviewBefore[key]);
  assert.deepEqual(actions, ['tools', 'tools'], 'load retries must not call preview, share, connect or disconnect');
});

test('late success and failure after unmount cannot update state or finish a removed view', async () => {
  for (const settlement of ['success', 'failure']) {
    const lifecycle = new LoadLifecycle(), response = deferred(), view = observedState(); lifecycle.activate();
    const pending = lifecycle.load(() => response.promise, view.callbacks);
    lifecycle.deactivate(); const atRemoval = { ...view.state };
    if (settlement === 'success') response.resolve({ tools: [{ name: 'old' }] }); else response.reject(new Error('Old failure'));
    assert.equal(await pending, 'ignored'); assert.deepEqual(view.state, atRemoval);
    assert.equal(await lifecycle.load(() => assert.fail('Unmounted view must not fetch'), view.callbacks), 'ignored');
  }
});

test('changed lifecycle discards an old response without releasing or overwriting the new load', async () => {
  const lifecycle = new LoadLifecycle(), old = deferred(), fresh = deferred(), view = observedState();
  lifecycle.activate(); const first = lifecycle.load(() => old.promise, view.callbacks);
  lifecycle.deactivate(); lifecycle.activate();
  const second = lifecycle.load(() => fresh.promise, view.callbacks);
  old.resolve({ status: 'old account' }); assert.equal(await first, 'ignored');
  assert.equal(view.state.loading, true); assert.equal(view.state.value, null); assert.equal(view.state.finishes, 0);
  assert.equal(await lifecycle.load(() => assert.fail('New load is still pending'), view.callbacks), 'pending');
  fresh.resolve({ status: 'current account' }); assert.equal(await second, 'applied');
  assert.equal(view.state.loading, false); assert.equal(view.state.value.status, 'current account'); assert.equal(view.state.finishes, 1);
});

test('invalidated status response cannot overwrite a later mutation and stale completion guards expire', async () => {
  const lifecycle = new LoadLifecycle(), response = deferred(), view = observedState(); lifecycle.activate();
  const beforeMutation = lifecycle.current(), pending = lifecycle.load(() => response.promise, view.callbacks);
  lifecycle.invalidate(); const duringMutation = lifecycle.current(); view.state.value = { status: 'disconnected' };
  response.resolve({ status: 'connected' }); assert.equal(await pending, 'ignored');
  assert.equal(beforeMutation(), false); assert.equal(duringMutation(), true);
  assert.equal(view.state.value.status, 'disconnected');
  lifecycle.deactivate(); assert.equal(duringMutation(), false, 'late preview/share results must not update or notify an unmounted dialog');
});
