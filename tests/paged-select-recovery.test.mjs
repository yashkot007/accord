import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { populated } from './helpers/large-room.mjs';

// Run the actual component and client transport with a small hook/element host.
// Only React's host is replaced; no browser/account or production fetch is used.
const hostKey = Symbol.for('accord.synthetic.paged-select-host');
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../app/paged-select.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  plugins: [{ name: 'synthetic-choice-host', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'react'
      ? `const host=()=>globalThis[Symbol.for('accord.synthetic.paged-select-host')];export const useState=(...a)=>host().useState(...a),useRef=(...a)=>host().useRef(...a),useEffect=(...a)=>host().useEffect(...a);`
      : `export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;` }));
    builder.onResolve({ filter: /(?:^|\/)client-request(?:\.ts)?$/ }, () => ({ path: new URL('../lib/client-request.ts', import.meta.url).href, external: true }));
  } }],
});
const { PagedSelect } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const descendants = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const textOf = node => Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.props?.children) : String(node ?? '');

function mounted(t, props) {
  const previousHost = globalThis[hostKey], previousDocument = globalThis.document;
  const document = { body: {}, activeElement: null }; document.activeElement = document.body; globalThis.document = document;
  const slots = [], refs = new Set(); let next = 0, dirty = true, effects = [], tree, removed = false;
  const host = {
    useState(initial) {
      const index = next++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => { const value = typeof update === 'function' ? update(slots[index].value) : update; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }];
    },
    useRef(initial) { const index = next++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(effect, deps) {
      const index = next++, previous = slots[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  function commit() {
    const current = new Set();
    for (const node of descendants(tree)) if (node.props?.ref) {
      const ref = node.props.ref; current.add(ref);
      ref.current ??= { isConnected: true, focus() { document.activeElement = this; } };
      ref.current.isConnected = true;
    }
    for (const ref of refs) if (!current.has(ref)) { if (ref.current) { ref.current.isConnected = false; if (document.activeElement === ref.current) document.activeElement = document.body; } ref.current = null; }
    refs.clear(); for (const ref of current) refs.add(ref);
  }
  function flush() {
    if (removed) return;
    for (let count = 0; dirty; count++) {
      assert.ok(count < 20, 'The component should settle its state without a render loop');
      dirty = false; next = 0; effects = []; globalThis[hostKey] = host; tree = PagedSelect(props); commit();
      for (const effect of effects) effect();
    }
  }
  const view = {
    flush, document,
    async settle() { await new Promise(resolve => setImmediate(resolve)); flush(); await Promise.resolve(); },
    select() { return descendants(tree).find(node => node.type === 'select'); },
    button(label) { return descendants(tree).find(node => node.type === 'button' && textOf(node) === label); },
    options() { return descendants(tree).filter(node => node.type === 'option').map(node => node.props.value); },
    text() { return textOf(tree); },
    choose(value) { this.select().props.onChange({ target: { value } }); flush(); },
    click(label, focus = false) { const button = this.button(label); assert.ok(button, `Expected ${label}`); if (focus) button.props.ref.current.focus(); button.props.onClick(); flush(); },
    update(nextProps) { props = { ...props, ...nextProps }; dirty = true; flush(); },
    unmount() { if (removed) return; removed = true; for (const slot of slots) slot?.cleanup?.(); for (const ref of refs) { if (ref.current) ref.current.isConnected = false; ref.current = null; } },
  };
  t.after(() => { view.unmount(); globalThis.document = previousDocument; if (previousHost === undefined) delete globalThis[hostKey]; else globalThis[hostKey] = previousHost; });
  flush(); return view;
}

function transport(t, workspace, intercept = () => undefined) {
  const previousFetch = globalThis.fetch, requests = [];
  async function read(path) {
    const params = new URL(path, 'https://accord.synthetic').searchParams;
    try { return Response.json(await workspace.humanChoices(params.get('choices'), { space_id: params.get('space') || undefined, capability: params.get('capability') || undefined, owned: params.get('owned') || undefined, cursor: params.get('cursor') || undefined })); }
    catch (error) { return Response.json({ error: error.message }, { status: error.status || 500 }); }
  }
  globalThis.fetch = (path, init) => {
    assert.equal(init?.method, undefined, 'Choice recovery must remain read-only');
    const request = new URL(path, 'https://accord.synthetic'); requests.push(request);
    return intercept(request, requests.length) ?? read(path);
  };
  t.after(() => { globalThis.fetch = previousFetch; }); return { requests, read };
}
function changeGeneration(f) { f.db.sqlite.prepare('UPDATE members SET membership_key=? WHERE space_id=? AND user_id=?').run(crypto.randomUUID(), f.space.id, f.a.user.id); }
const propsFor = (f, extra = {}) => ({ id: 'source-choice', name: 'source_id', label: 'Source', source: { kind: 'sources', spaceId: f.space.id }, ...extra });

test('a real membership generation change rejects the old cursor, then explicit retry starts a fresh page once', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close());
  const response = deferred(); let hold = false;
  const api = transport(t, f.a, request => hold && !request.searchParams.has('cursor') ? response.promise : undefined);
  const changes = [], loading = [], selected = [], view = mounted(t, propsFor(f, { onChange: value => changes.push(value), onSelected: item => selected.push(item), onLoading: value => loading.push(value) }));
  await view.settle(); view.choose('source-003');
  const staleCursor = api.requests[0].searchParams.get('cursor'); assert.equal(staleCursor, null);
  const original = await f.a.humanChoices('sources', { space_id: f.space.id }); changeGeneration(f);
  await assert.rejects(f.a.humanChoices('sources', { space_id: f.space.id, cursor: original.next_cursor }), { status: 400 });
  view.click('More choices'); await view.settle();
  assert.match(view.text(), /These choices changed/); assert.equal(api.requests.length, 2); assert.equal(view.button('More choices'), undefined);
  await view.settle(); assert.equal(api.requests.length, 2, 'There must be no automatic recovery fetch');
  hold = true; view.click('Try again', true);
  assert.equal(api.requests.length, 3); assert.equal(api.requests[2].searchParams.has('cursor'), false); assert.equal(view.select().props.disabled, true); assert.equal(loading.at(-1), true);
  view.click('Try again'); assert.equal(api.requests.length, 3, 'Repeated retries must not queue another request');
  hold = false; response.resolve(await api.read(api.requests[2].href)); await view.settle();
  assert.equal(view.select().props.value, 'source-003'); assert.equal(view.select().props.disabled, false); assert.equal(loading.at(-1), false);
  assert.equal(selected.at(-1).id, 'source-003'); assert.equal(changes.at(-1), 'source-003'); assert.equal(view.options().length, 21);
  assert.equal(view.button('Try again'), undefined); assert.equal(view.document.activeElement, view.select().props.ref.current);
  view.click('More choices'); await view.settle(); assert.equal(view.options().length, 41);
});

test('a later-page selection is retained for explicit verification without appearing usable while absent', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close()); const api = transport(t, f.a);
  const form = { destination: '', title: 'Reviewed title', excerpt: 'Keep this edited excerpt' }, selected = [];
  const view = mounted(t, propsFor(f, { onChange: value => { form.destination = value; }, onSelected: item => selected.push(item) }));
  await view.settle(); view.click('More choices'); await view.settle(); view.choose('source-030'); changeGeneration(f);
  view.click('More choices'); await view.settle(); view.click('Try again'); await view.settle();
  assert.equal(view.select().props.value, ''); assert.equal(form.destination, ''); assert.equal(selected.at(-1), undefined); assert.ok(!view.options().includes('source-030'));
  assert.match(view.text(), /previous choice needs to be checked/); assert.equal(api.requests.length, 4, 'Do not automatically traverse to the old selection');
  view.click('More choices'); await view.settle();
  assert.equal(view.select().props.value, 'source-030'); assert.equal(form.destination, 'source-030'); assert.equal(selected.at(-1).id, 'source-030');
  assert.doesNotMatch(view.text(), /previous choice/); assert.equal(form.title, 'Reviewed title'); assert.equal(form.excerpt, 'Keep this edited excerpt');
});

test('a removed selection is cleared and a deliberate new choice cancels the retained selection', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close()); transport(t, f.a);
  const changes = [], view = mounted(t, propsFor(f, { onChange: value => changes.push(value) })); await view.settle(); view.choose('source-003');
  changeGeneration(f); view.click('More choices'); await view.settle();
  f.db.sqlite.prepare("DELETE FROM sources WHERE id='source-003' OR id>='source-020'").run();
  view.click('Try again'); await view.settle();
  assert.equal(view.select().props.value, ''); assert.equal(changes.at(-1), ''); assert.ok(!view.options().includes('source-003')); assert.equal(view.button('More choices'), undefined);
  assert.match(view.text(), /previous choice is no longer available/);
  view.choose('source-004'); assert.equal(view.select().props.value, 'source-004'); assert.doesNotMatch(view.text(), /previous choice/);
});

test('a transient page interruption retries its original cursor and retains the usable selection', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close()); const broken = deferred();
  const api = transport(t, f.a, (_request, count) => count === 2 ? broken.promise : undefined), view = mounted(t, propsFor(f)); await view.settle(); view.choose('source-003');
  view.click('More choices'); broken.reject(new Error('Synthetic interruption')); await view.settle();
  assert.match(view.text(), /interrupted/); assert.equal(view.select().props.value, 'source-003'); assert.equal(api.requests.length, 2);
  view.click('Try again'); await view.settle();
  assert.equal(api.requests[2].searchParams.get('cursor'), api.requests[1].searchParams.get('cursor')); assert.equal(view.options().length, 41); assert.equal(view.select().props.value, 'source-003');
});

test('a late recovery page cannot overwrite choices or focus after the source changes', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close()); const late = deferred(); let hold = false;
  const another = await f.a.human('create_space', { name: 'Another room', topic: 'Synthetic', purpose: 'Source switch' });
  const otherSource = await f.a.human('add_source', { space_id: another.id, title: 'Another choice', content: 'Synthetic note', kind: 'Note' });
  const api = transport(t, f.a, request => hold && request.searchParams.get('space') === f.space.id && !request.searchParams.has('cursor') ? late.promise : undefined);
  const choices = [], view = mounted(t, propsFor(f, { onChange: value => choices.push(value) })); await view.settle(); view.choose('source-003'); changeGeneration(f);
  view.click('More choices'); await view.settle(); hold = true; view.click('Try again', true);
  view.update({ source: { kind: 'sources', spaceId: another.id } }); await view.settle();
  assert.deepEqual(view.options(), ['', otherSource.id]); const before = [...choices], focus = view.document.activeElement;
  late.resolve(await api.read(api.requests[2].href)); await view.settle();
  assert.deepEqual(view.options(), ['', otherSource.id]); assert.equal(view.select().props.value, ''); assert.deepEqual(choices, before); assert.equal(view.document.activeElement, focus);
  assert.doesNotMatch(view.text(), /previous choice|Start again/); assert.equal(api.requests.length, 4);
});

test('unmounting during explicit recovery ignores a late rejection and does not notify the removed form', async t => {
  const f = await populated(); t.after(() => f.db.sqlite.close()); const late = deferred(); let hold = false;
  const api = transport(t, f.a, request => hold && !request.searchParams.has('cursor') ? late.promise : undefined);
  const events = [], view = mounted(t, propsFor(f, { onChange: value => events.push(['choice', value]), onLoading: value => events.push(['loading', value]) })); await view.settle(); changeGeneration(f);
  view.click('More choices'); await view.settle(); hold = true; view.click('Try again'); view.unmount(); const before = [...events];
  late.reject(new Error('Late synthetic interruption')); await view.settle();
  assert.deepEqual(events, before); assert.equal(api.requests.length, 3);
});
