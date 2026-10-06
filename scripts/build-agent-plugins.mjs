import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { agentTools } from '../lib/agent-tools.ts';
import { accordMcpUrl, pluginVersion, assistants } from '../lib/assistant-connections.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(resolve(root, 'public/.well-known/accord.json'), 'utf8'));
const catalog = Buffer.from(JSON.stringify({
  name: 'Accord', version: pluginVersion, server_version: inventory.version, endpoint: accordMcpUrl,
  transport: 'Streamable HTTP', protocol_versions: inventory.connection.protocol_versions,
  authentication: 'Sites-managed Accord account sign-in. No credentials are included in this package.',
  tools: agentTools,
}, null, 2) + '\n');

// Fixed allowlists keep unrelated checkout files and account data out of downloads.
const packages = [
  { id: 'claude', directory: 'claude', files: ['.claude-plugin/plugin.json', '.mcp.json', 'skills/accord/SKILL.md', 'README.md'] },
  { id: 'grok', directory: 'grok-bot', files: ['.cursor-plugin/plugin.json', 'mcp.json', 'skills/accord/SKILL.md', 'README.md', 'RESEARCH.md'] },
  { id: 'muse', directory: 'muse', files: ['README.md', 'setup-prompt.txt'] },
];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small, deterministic ZIP archives using the standard stored-entry format.
// No executable bits, timestamps from the checkout, subprocesses or credentials.
export function zipEntries(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, bytes] of entries) {
    if (!/^accord\/[\w./-]+$/.test(path) || path.split('/').includes('..')) throw new Error('Unsafe package path.');
    const name = Buffer.from(path), crc = crc32(bytes), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(0x21, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42); central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function checkConfig(relative, bytes) {
  if (!relative.endsWith('.json') || !['.mcp.json', 'mcp.json'].includes(relative)) return;
  const config = JSON.parse(bytes.toString()), servers = config.mcpServers;
  if (Object.keys(config).length !== 1 || !servers || Object.keys(servers).join() !== 'accord') throw new Error('Unexpected server configuration.');
  const server = servers.accord;
  if (server.url !== accordMcpUrl || Object.keys(server).some(key => !['type', 'url'].includes(key)) || (server.type && server.type !== 'http')) {
    throw new Error('Packages must use the shared HTTPS service without headers, processes or credentials.');
  }
}

export async function buildPackages({ check = false } = {}) {
  const output = resolve(root, 'public/plugins');
  if (!check) await mkdir(output, { recursive: true });
  const releases = [];
  for (const specification of packages) {
    const recipe = assistants.find(item => item.id === specification.id);
    const entries = [];
    for (const relative of specification.files) {
      const path = resolve(root, 'plugins', specification.directory, relative);
      if (!(await lstat(path)).isFile()) throw new Error(`Package source must be a regular file: ${relative}`);
      const bytes = await readFile(path); checkConfig(relative, bytes);
      entries.push([`accord/${relative}`, bytes]);
    }
    entries.push(['accord/reference/tools.json', catalog]);
    entries.sort(([left], [right]) => left.localeCompare(right, 'en'));
    const bytes = zipEntries(entries), path = resolve(root, `public${recipe.packagePath}`);
    if (check) {
      if (!(await readFile(path)).equals(bytes)) throw new Error(`Stale package: ${recipe.packagePath}. Run npm run plugins:build.`);
    } else await writeFile(path, bytes);
    releases.push({ provider: recipe.name, version: pluginVersion, kind: recipe.packageKind, path: recipe.packagePath,
      native_authorization: 'unverified', sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length });
  }
  const index = Buffer.from(JSON.stringify({ version: pluginVersion, endpoint: accordMcpUrl, packages: releases }, null, 2) + '\n');
  const indexPath = resolve(output, 'index.json'), toolsPath = resolve(output, 'tools.json');
  if (check) {
    if (!(await readFile(indexPath)).equals(index) || !(await readFile(toolsPath)).equals(catalog)) throw new Error('Stale shared package index or tool inventory.');
  } else { await writeFile(indexPath, index); await writeFile(toolsPath, catalog); }
  return releases;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Unknown packaging argument.');
  const releases = await buildPackages({ check: process.argv.includes('--check') });
  process.stdout.write(`${process.argv.includes('--check') ? 'Verified' : 'Built'} ${releases.length} Accord packages from the shared MCP tool contract.\n`);
}
