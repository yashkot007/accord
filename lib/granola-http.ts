import { AppError } from './workspace.ts';
import { discardRequestBody, readBoundedText } from './request-body.ts';
import type { Granola } from './granola.ts';
import { GranolaRequestBudget } from './granola-mcp.ts';
export async function handleGranolaRequest(request:Request,load:()=>Promise<Granola>,budget=new GranolaRequestBudget(18_000)){
  const headers={'Cache-Control':'no-store'};
  try{
    if(request.method==='GET')return Response.json(await (await load()).status(),{headers});
    if(request.method!=='POST'){discardRequestBody(request);throw new AppError('This request method is not supported.',405);}
    if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'){discardRequestBody(request);throw new AppError('Open this action from your workspace.',403);}
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){discardRequestBody(request);throw new AppError('Expected a workspace request.');}
    // The full reviewed excerpt can use six JSON bytes per character. Bound its
    // actual envelope and total upload time before resolving private services.
    const body=JSON.parse(await readBoundedText(request,128*1024,{timeoutMs:5000}));
    if(!body||typeof body.action!=='string'||!body.args||typeof body.args!=='object'||Array.isArray(body.args))throw new AppError('Choose a valid connection action.');
    if(!['connect','disconnect','tools','preview','share'].includes(body.action))throw new AppError('Choose a supported connection action.');
    const granola=await load();
    let result;
    switch(body.action){case 'connect':result=await granola.start(new URL(request.url).origin,budget);break;case 'disconnect':result=await granola.disconnect();break;case 'tools':result=await granola.tools(budget);break;case 'preview':result=await granola.preview(body.args,budget);break;case 'share':result=await granola.share(body.args);break;default:throw new AppError('Choose a supported connection action.');}
    return Response.json(result,{headers});
  }catch(e){
    if(e instanceof AppError)return Response.json({error:e.message},{status:e.status,headers});
    if(e instanceof SyntaxError)return Response.json({error:'This request could not be read.'},{status:400,headers});
    console.error('Granola request failed',{kind:e instanceof Error?e.name:'UnknownError'});
    return Response.json({error:'The Granola connection is temporarily unavailable. Please try again.'},{status:503,headers});
  }
}
