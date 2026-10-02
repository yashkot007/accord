export class RequestFailure extends Error {
  status:number;
  constructor(message:string,status=0){super(message);this.status=status;}
}
/** No automatic retry of writes. Callers retain request IDs and let the person retry. */
export async function clientRequest(path:string, action?:string, args?:Record<string,unknown>) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(path,{...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args})}:{cache:'no-store' as const}),signal:controller.signal});
    let result:Record<string,any>;try{result=await response.json() as Record<string,any>;}catch{throw new RequestFailure('Accord returned an unreadable response. Your input is still here. Refresh before resubmitting.',response.status);}
    if(!response.ok)throw new RequestFailure(result.error||'This action could not be completed. Your input is still here.',response.status);
    return result;
  }catch(error){
    if(error instanceof RequestFailure)throw error;
    throw new RequestFailure(controller.signal.aborted?'The connection timed out. Your input is still here. A save may have completed; refresh before retrying.':'The connection was interrupted. Your input is still here. Check your connection and retry.');
  }finally{clearTimeout(timer);}
}
