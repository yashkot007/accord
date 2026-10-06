import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { agentTools } from '../lib/agent-tools.ts';
import { accordMcpUrl, assistantFor, verificationPrompt, museConnectionRequest } from '../lib/assistant-connections.ts';
import { buildPackages, zipEntries } from '../scripts/build-agent-plugins.mjs';

// Independently read standard ZIP directory records and stored file bodies.
function unzip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let count = 0; count < bytes.readUInt16LE(end + 10); count++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 10), 0);
    const nameLength = bytes.readUInt16LE(offset + 28), size = bytes.readUInt32LE(offset + 24);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt32LE(local + 22), size);
    assert.equal(bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)).toString(), name);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(!files.has(name)); files.set(name, bytes.subarray(start, start + size));
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  assert.equal(offset, end); return files;
}

test('published setup packages are reproducible and match the live tool contract', async () => {
  const releases = await buildPackages({ check: true });
  const catalog = JSON.parse(await readFile(new URL('../public/plugins/tools.json', import.meta.url)));
  assert.deepEqual(catalog.tools, agentTools);
  assert.equal(catalog.endpoint, accordMcpUrl);
  for (const release of releases) {
    const bytes = await readFile(new URL(`../public${release.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
    const files = unzip(bytes);
    assert.deepEqual(JSON.parse(files.get('accord/reference/tools.json')), catalog);
    assert.ok([...files.keys()].every(path => path.startsWith('accord/') && !path.split('/').includes('..')));
    assert.ok(![...files.keys()].some(path => /(?:\.env|cookies|credentials|hooks|node_modules|\.git\/)/.test(path)));
    assert.equal(release.native_authorization, 'unverified');
  }
});

test('vendor packages use one HTTPS service with no token, process or identity configuration', async () => {
  for (const [path, configName] of [['claude', '.mcp.json'], ['grok-bot', 'mcp.json']]) {
    const config = JSON.parse(await readFile(new URL(`../plugins/${path}/${configName}`, import.meta.url)));
    assert.deepEqual(Object.keys(config), ['mcpServers']);
    assert.deepEqual(Object.keys(config.mcpServers), ['accord']);
    assert.equal(config.mcpServers.accord.url, accordMcpUrl);
    assert.ok(Object.keys(config.mcpServers.accord).every(key => ['type', 'url'].includes(key)));
    const manifestPath = path === 'claude' ? '.claude-plugin' : '.cursor-plugin';
    const manifest = JSON.parse(await readFile(new URL(`../plugins/${path}/${manifestPath}/plugin.json`, import.meta.url)));
    assert.equal(manifest.name, 'accord'); assert.equal(manifest.license, undefined);
  }
  const muse = unzip(await readFile(new URL('../public/plugins/accord-muse.zip', import.meta.url)));
  assert.ok(![...muse.keys()].some(path => /plugin\.json|mcp\.json/.test(path)));
});

test('setup selects exact profiles, rejects disconnected ones and confines setup to a room read', () => {
  const profile = { id: 'selected-profile', name: 'A "quoted" name', provider: 'Meta Muse', status: 'pending' };
  const prompt = verificationPrompt(profile, 'selected-room');
  assert.ok(prompt.includes(JSON.stringify(profile.name))); assert.ok(prompt.includes('"selected-room"'));
  assert.ok(!prompt.includes('read_inbox')); assert.ok(!prompt.includes('read_context'));
  assert.ok(prompt.includes('do not assign work'));
  assert.throws(() => verificationPrompt({ ...profile, status: 'revoked' }), /disconnected/);
  const muse = museConnectionRequest(accordMcpUrl, profile, 'selected-room');
  assert.ok(muse.includes('Do not substitute browser automation'));
  assert.ok(muse.includes('"selected-profile"')); assert.ok(muse.includes('"selected-room"'));
  for (const provider of ['Claude Code', ' claude ', 'Grokbot', 'Meta Muse', 'new independent client']) {
    assert.ok(assistantFor(provider));
  }
  assert.equal(assistantFor('unrecognized agent').id, 'other');
});

test('ZIP generation refuses unsafe archive paths', () => {
  for (const path of ['accord/../../credential', '/absolute', 'accord/./../secret', 'other/plugin.json']) {
    assert.throws(() => zipEntries([[path, Buffer.from('data')]]), /Unsafe package path/);
  }
});
