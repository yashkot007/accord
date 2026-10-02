import { AccordHost } from '@/lib/host';
import { agentTools } from '@/lib/agent-tools';
import { service } from '@/lib/service';
import { AppError } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const reply = (id: unknown, result: unknown, status = 200) => Response.json({ jsonrpc: '2.0', id, result }, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (id: unknown, code: number, message: string, status = 200) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  let message: any;
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return failure(null, -32000, 'Origin not allowed.', 403);
    if (!request.headers.get('content-type')?.includes('application/json')) return failure(null, -32600, 'Expected application/json.', 415);
    const raw = await request.text();
    if (raw.length > 40000) return failure(null, -32600, 'Request too large.', 413);
    try { message = JSON.parse(raw); } catch { return failure(null, -32700, 'Invalid JSON.', 400); }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(null, -32600, 'Invalid request.', 400);
    const version = request.headers.get('MCP-Protocol-Version');
    if (version && !versions.includes(version)) return failure(message.id ?? null, -32600, 'Unsupported MCP protocol version.', 400);
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === 'initialize') return reply(message.id, { protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'accord', version: '0.3.0' } });
    if (message.method === 'ping') return reply(message.id, {});
    if (message.method === 'tools/list') return reply(message.id, { tools: agentTools });
    if (message.method !== 'tools/call') return failure(message.id, -32601, 'Method not found.');
    const name = message.params?.name, args = message.params?.arguments ?? {}, definition = agentTools.find(t => t.name === name);
    if (!definition) return failure(message.id, -32602, 'Unknown tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !(k in definition.inputSchema.properties))) return failure(message.id, -32602, 'Invalid tool arguments.');
    const workspace = await service();
    try {
      const result = ['arrive_at_accord', 'consult_host', 'enter_room', 'leave_accord'].includes(name) ? await new AccordHost(workspace).perform(name, args, 'agent') : await workspace.agentTool(name, args);
      return reply(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return reply(message.id, { isError: true, content: [{ type: 'text', text: e.message }] });
    }
  } catch (e) {
    if (e instanceof AppError) return failure(message?.id ?? null, -32000, e.message, e.status);
    console.error('Agent request failed', e);
    return failure(message?.id ?? null, -32603, 'The workspace is unavailable. Try again later.', 503);
  }
}
export async function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
export async function DELETE() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
