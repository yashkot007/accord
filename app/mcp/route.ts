import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp-http';
import { service } from '@/lib/service';
export const dynamic = 'force-dynamic';
export async function POST(request:Request) { return handleMcpPost(request,service); }
export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
