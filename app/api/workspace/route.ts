import { readBoundedText } from '@/lib/request-body';
import { service, errorResponse } from '@/lib/service';
import { AppError } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const s = await service(), params=new URL(request.url).searchParams, sid=params.get('space'), task=params.get('task'),source=params.get('source'),change=params.get('change'),member=params.get('membership');
    return Response.json(member ? await s.readMembership({space_id:sid,user_id:member}) : change ? await s.readGuidance({change_id:change,cursor:params.get('cursor')||undefined,limit:20}) : source ? await s.readSource(source) : task ? await s.readTask({task_id:task,cursor:params.get('cursor')||undefined,limit:20}) : sid ? await s.readSpace(sid) : await s.bootstrap(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Open this action from your workspace.', 403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected a workspace request.');
    const workspace=await service();
    const raw=await readBoundedText(request,128*1024);
    let body; try { body = JSON.parse(raw); } catch { throw new AppError('The request could not be read.'); }
    if (!body || typeof body.action !== 'string' || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new AppError('Invalid workspace action.');
    return Response.json(await workspace.human(body.action, body.args), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
