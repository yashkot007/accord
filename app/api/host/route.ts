import { AccordHost } from '@/lib/host';
import { service, errorResponse } from '@/lib/service';
import { AppError } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {return Response.json(await new AccordHost(await service()).arrivals(),{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
  try {
    if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Open this visit from Accord.',403);
    if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError('Expected a host request.');
    const raw=await request.text();if(raw.length>12000)throw new AppError('This request is too large.',413);
    let body;try{body=JSON.parse(raw);}catch{throw new AppError('The request could not be read.');}
    if(!body||typeof body.action!=='string'||!body.args||typeof body.args!=='object'||Array.isArray(body.args))throw new AppError('Invalid host request.');
    return Response.json(await new AccordHost(await service()).perform(body.action,body.args),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}
