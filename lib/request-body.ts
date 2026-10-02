import { AppError } from './workspace.ts';

/** Bound bytes while consuming the stream, even without a trustworthy Content-Length. */
export async function readBoundedText(request: Request, limit: number): Promise<string> {
  const declared=request.headers.get('content-length');
  if(declared && /^\d+$/.test(declared) && Number(declared)>limit){
    await request.body?.cancel().catch(()=>{});
    throw new AppError('This request is too large.',413);
  }
  if(!request.body)return '';
  const reader=request.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0, text='';
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>limit){await reader.cancel().catch(()=>{});throw new AppError('This request is too large.',413);}
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  }catch(error){
    if(error instanceof AppError)throw error;
    await reader.cancel().catch(()=>{});
    throw new AppError('This request could not be read. Please try again.',400);
  }finally{reader.releaseLock();}
}
