import { AppError } from './workspace.ts';

/** Discard without waiting for an uncooperative source's cancellation promise. */
export function discardRequestBody(request: Request) {
  try { void request.body?.cancel().catch(() => {}); } catch { /* Already locked or closed. */ }
}

/** Bound bytes and optionally total upload time, even without Content-Length. */
export async function readBoundedText(request: Request, limit: number, options: { timeoutMs?: number } = {}): Promise<string> {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) throw new RangeError('Upload timeout must be a positive integer.');
  if (request.signal.aborted) { discardRequestBody(request); throw new AppError('This request was interrupted. Please try again.',400); }
  const declared=request.headers.get('content-length');
  if(declared && /^\d+$/.test(declared) && Number(declared)>limit){
    discardRequestBody(request);
    throw new AppError('This request is too large.',413);
  }
  if(!request.body)return '';
  const reader=request.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0, text='';
  let interrupt: (error: AppError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  let stopped: AppError | undefined;
  const stop = (error: AppError) => {
    if (stopped) return;
    stopped = error;
    void reader.cancel().catch(() => {});
    interrupt(error);
  };
  const onAbort = () => stop(new AppError('This request was interrupted. Please try again.',400));
  request.signal.addEventListener('abort', onAbort, { once: true });
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => stop(new AppError('This request took too long to arrive. Please try again.',408)), options.timeoutMs);
  try{
    const consume = async () => {
      while(true){
        const {value,done}=await reader.read();
        if(stopped)throw stopped;
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>limit){void reader.cancel().catch(()=>{});throw new AppError('This request is too large.',413);}
        text+=decoder.decode(value,{stream:true});
      }
      return text+decoder.decode();
    };
    // Race once per upload, rather than retaining an interrupt listener for every chunk.
    return await Promise.race([consume(),interrupted]);
  }catch(error){
    if(error instanceof AppError)throw error;
    void reader.cancel().catch(()=>{});
    throw new AppError('This request could not be read. Please try again.',400);
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    request.signal.removeEventListener('abort',onAbort);
    reader.releaseLock();
  }
}
