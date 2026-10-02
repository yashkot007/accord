import { service, errorResponse } from '@/lib/service';
import { AppError } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const s = await service(), sid = new URL(request.url).searchParams.get('space');
    return Response.json(sid ? await s.readSpace(sid) : await s.bootstrap(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Open this action from your workspace.', 403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected a workspace request.');
    const raw = await request.text();
    if (raw.length > 40000) throw new AppError('This request is too large.', 413);
    let body; try { body = JSON.parse(raw); } catch { throw new AppError('The request could not be read.'); }
    if (!body || typeof body.action !== 'string' || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new AppError('Invalid workspace action.');
    return Response.json(await (await service()).human(body.action, body.args), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
