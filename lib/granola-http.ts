import { AppError } from './workspace.ts';
import { readBoundedText } from './request-body.ts';
import type { Granola } from './granola.ts';
export async function handleGranolaRequest(request:Request,load:()=>Promise<Granola>){
  const headers={'Cache-Control':'no-store'};
  try{
    if(request.method==='GET')return Response.json(await (await load()).status(),{headers});
    if(request.method!=='POST')throw new AppError('This request method is not supported.',405);
    if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Open this action from your workspace.',403);
    if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError('Expected a workspace request.');
    const granola=await load(),body=JSON.parse(await readBoundedText(request,64*1024));
    if(!body||typeof body.action!=='string'||!body.args||typeof body.args!=='object'||Array.isArray(body.args))throw new AppError('Choose a valid connection action.');
    let result;
    switch(body.action){case 'connect':result=await granola.start(new URL(request.url).origin);break;case 'disconnect':result=await granola.disconnect();break;case 'tools':result=await granola.tools();break;case 'preview':result=await granola.preview(body.args);break;case 'share':result=await granola.share(body.args);break;default:throw new AppError('Choose a supported connection action.');}
    return Response.json(result,{headers});
  }catch(e){
    if(e instanceof AppError)return Response.json({error:e.message},{status:e.status,headers});
    if(e instanceof SyntaxError)return Response.json({error:'This request could not be read.'},{status:400,headers});
    console.error('Granola request failed',{kind:e instanceof Error?e.name:'UnknownError'});
    return Response.json({error:'The Granola connection is temporarily unavailable. Please try again.'},{status:503,headers});
  }
}
