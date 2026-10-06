import { AppError } from './workspace.ts';

export const GRANOLA_MCP='https://mcp.granola.ai/mcp';
export const GRANOLA_ISSUER='https://mcp-auth.granola.ai';
export const READ_TOOLS=['get_account_info','list_meetings','get_meetings','query_granola_meetings'] as const;
export type GranolaTool = {name:string;description?:string;inputSchema:Record<string,any>};
export type Fetcher = typeof fetch;
type ProviderRequest={response:Response;limit:number;finish:()=>void;consume:<T>(operation:()=>Promise<T>,cancel?:()=>void)=>Promise<T>};
const deadlineError=()=>new AppError('Granola took too long to respond. Please try again.',502);

/** Internal workflow budget: reuse this object across discovery, refresh and reads. */
export class GranolaRequestBudget {
  private readonly deadlineAt:number;
  private readonly clock:()=>number;
  private lastClock:number;
  constructor(timeoutMs:number,clock:()=>number=()=>performance.now()) {
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new RangeError('Choose a positive Granola request budget.');
    this.clock=clock;this.lastClock=clock();
    if(!Number.isFinite(this.lastClock))throw new RangeError('Choose a finite Granola request clock.');
    this.deadlineAt=this.lastClock+timeoutMs;
  }
  remainingMs(){this.lastClock=Math.max(this.lastClock,this.clock());return Math.max(0,this.deadlineAt-this.lastClock);}
  assertActive(){if(this.remainingMs()<=0)throw deadlineError();}
}

/** Discard without depending on the stream source's cancellation promise. */
function discardBody(body:ReadableStream<Uint8Array>|null) {
  try {void body?.cancel().catch(()=>{});} catch {/* Locked or already closed. */}
}
function discardReader(reader:ReadableStreamDefaultReader<Uint8Array>) {
  try {void reader.cancel().catch(()=>{});} catch {/* Cleanup cannot delay the result. */}
}

/** One deadline covers fetch headers and consumption; a slow chunk never resets it. */
class ProviderDeadline {
  readonly controller=new AbortController();
  private stopped:AppError|undefined;
  private interrupt:(error:AppError)=>void=()=>{};
  private readonly interrupted=new Promise<never>((_,reject)=>{this.interrupt=reject;});
  private readonly timer:ReturnType<typeof setTimeout>|undefined;
  private readonly budget:GranolaRequestBudget|undefined;
  private readonly expiresAt:number;
  private cancel:()=>void=()=>{};
  constructor(budget?:GranolaRequestBudget) {
    this.budget=budget;
    // Also observe expiry between phases, or after a caller ignores the body.
    void this.interrupted.catch(()=>{});
    const remaining=Math.min(12000,budget?.remainingMs()??12000);
    this.expiresAt=performance.now()+remaining;
    if(remaining<=0){this.stop();return;}
    this.timer=setTimeout(()=>this.stop(),remaining);
  }
  private stop() {
    if(this.stopped)return;
    this.stopped=deadlineError();this.interrupt(this.stopped);this.controller.abort();
    try {this.cancel();} catch {/* Cancellation is best effort. */}
  }
  private checkExpiry(){if(performance.now()>=this.expiresAt||(this.budget&&this.budget.remainingMs()<=0))this.stop();}
  get expired(){this.checkExpiry();return this.stopped!==undefined;}
  async consume<T>(operation:()=>Promise<T>,cancel:()=>void=()=>{}):Promise<T> {
    this.checkExpiry();
    if(this.stopped)throw this.stopped;
    this.cancel=cancel;
    const work=Promise.resolve().then(()=>{if(this.stopped)throw this.stopped;return operation();});
    try {
      const result=await Promise.race([work,this.interrupted]);
      this.checkExpiry();
      // Abort/cancel may turn a pending read into EOF; that is not a complete reply.
      if(this.stopped)throw this.stopped;
      return result;
    }catch(error){if(this.stopped)throw this.stopped;throw error;}
    finally{this.cancel=()=>{};}
  }
  finish(){clearTimeout(this.timer);this.cancel=()=>{};}
}

export async function providerFetch(fetcher: Fetcher, url: string, init: RequestInit, limit=256*1024,budget?:GranolaRequestBudget):Promise<ProviderRequest> {
  const deadline=new ProviderDeadline(budget);
  const endpoint=url===GRANOLA_MCP?'mcp':url.endsWith('/oauth-protected-resource/mcp')?'resource_metadata':url.endsWith('/oauth-authorization-server')?'authorization_metadata':url.endsWith('/oauth2/register')?'registration':url.endsWith('/oauth2/token')?'token':'unknown';
  try {
    const response=await deadline.consume(async()=>{
      const result=await fetcher(url,{...init,redirect:'manual',signal:deadline.controller.signal});
      // A fetch adapter can settle after ignoring abort. Discard its late body.
      if(deadline.expired)discardBody(result.body);
      return result;
    });
    if(!response.ok) {
      discardBody(response.body);
      // Explicitly reject redirects: credentials must never travel to another destination.
      console.error('Granola upstream request rejected',{endpoint,status:response.status});
      if(response.status===401)throw new AppError('Granola needs you to sign in again.',401);
      if(response.status===429)throw new AppError('Granola is busy. Please wait before trying again.',429);
      throw new AppError('Granola could not complete this request. Please try again.',502);
    }
    return {response,finish:()=>deadline.finish(),limit,consume:<T>(operation:()=>Promise<T>,cancel?:()=>void)=>deadline.consume(operation,cancel)};
  } catch(e) {
    deadline.finish();if(e instanceof AppError)throw e;
    const name=e instanceof Error?e.name:'';
    // Never log upstream text, URLs, headers, bodies, tokens or account information.
    console.error('Granola upstream request failed',{endpoint,kind:['TypeError','AbortError','TimeoutError','Error'].includes(name)?name:'UnknownError',reason:deadline.controller.signal.aborted?'timeout':e instanceof Error&&/redirect/i.test(e.message)?'redirect_rejected':'transport_failure'});
    throw new AppError('Granola could not be reached. Please try again.',502);
  }
}
export async function boundedJson(fetcher:Fetcher,url:string,init:RequestInit,budget?:GranolaRequestBudget) {
  const request=await providerFetch(fetcher,url,init,256*1024,budget);
  try {return JSON.parse(await boundedBody(request));}
  catch(e){if(e instanceof AppError)throw e;throw new AppError('Granola returned an unreadable response.',502);}
  finally{request.finish();}
}
async function boundedBody(request:ProviderRequest) {
  const {response,limit}=request;
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
  try {return await request.consume(async()=>{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit)throw new AppError('Granola returned too much information. Narrow your search.',413);text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode();},()=>discardReader(reader));}
  finally{discardReader(reader);reader.releaseLock();}
}
/** No URLs or tool names supplied by visitors; each short-lived session discovers the actual provider schema. */
export class GranolaMcp {
  session:string|undefined;protocol='2025-06-18';
  private token:string;private fetcher:Fetcher;private budget:GranolaRequestBudget|undefined;
  constructor(token:string,fetcher:Fetcher=fetch,budget?:GranolaRequestBudget) {this.token=token;this.fetcher=fetcher;this.budget=budget;}
  async rpc(method:string,params:unknown={},notification=false) {
    const id=crypto.randomUUID();
    const headers:Record<string,string>={Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':this.protocol};
    if(this.session)headers['Mcp-Session-Id']=this.session;
    const request=await providerFetch(this.fetcher,GRANOLA_MCP,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})},256*1024,this.budget);
    try {
      const session=request.response.headers.get('Mcp-Session-Id');if(session&&session.length<=256)this.session=session;
      if(notification){discardBody(request.response.body);return null;}
      let envelope:any;
      if(request.response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader=request.response.body?.getReader();if(!reader)throw Error();
        const decoder=new TextDecoder();let buffer='',size=0;
        try {await request.consume(async()=>{while(!envelope){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>request.limit)throw new AppError('Granola returned too much information. Narrow your search.',413);buffer=(buffer+decoder.decode(next.value,{stream:true})).replaceAll('\r\n','\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const candidate=JSON.parse(data);if(candidate.id===id){envelope=candidate;break;}}}},()=>discardReader(reader));}
        finally{discardReader(reader);reader.releaseLock();}
      } else envelope=JSON.parse(await boundedBody(request));
      if(envelope?.jsonrpc!=='2.0'||envelope.id!==id||envelope.error||!('result' in envelope))throw new AppError('Granola could not complete this request. Please try again.',502);
      return envelope.result;
    } catch(e){if(e instanceof AppError)throw e;throw new AppError('Granola returned an unreadable response.',502);}
    finally{request.finish();}
  }
  async initialize() {
    const result=await this.rpc('initialize',{protocolVersion:this.protocol,capabilities:{},clientInfo:{name:'Accord',version:'0.10.0'}});
    if(!['2025-03-26','2025-06-18','2025-11-25'].includes(result?.protocolVersion))throw new AppError('Granola requires a connection version Accord does not yet support.',502);
    this.protocol=result.protocolVersion;await this.rpc('notifications/initialized',{},true);
  }
  async tools() {
    let cursor:string|undefined;const seen=new Set<string>(),tools:GranolaTool[]=[];
    for(let page=0;page<10;page++) {
      const result=await this.rpc('tools/list',cursor?{cursor}:{});
      if(!Array.isArray(result?.tools))throw new AppError('Granola returned an unreadable tool list.',502);
      for(const tool of result.tools)if(READ_TOOLS.includes(tool.name)&&tool.inputSchema?.type==='object')tools.push(tool);
      if(!result.nextCursor)return tools;
      if(typeof result.nextCursor!=='string'||seen.has(result.nextCursor))break;
      seen.add(result.nextCursor);cursor=result.nextCursor;
    }
    throw new AppError('Granola returned an incomplete tool list. Please try again.',502);
  }
  async call(tool:GranolaTool,args:Record<string,unknown>) {
    validateInput(tool.inputSchema,args);
    const result=await this.rpc('tools/call',{name:tool.name,arguments:args});
    if(result?.isError)throw new AppError('Granola could not read those notes. Check your filters, access and subscription.',502);
    const text=(Array.isArray(result?.content)?result.content:[]).filter((c:any)=>c.type==='text'&&typeof c.text==='string').map((c:any)=>c.text).join('\n\n')|| (result?.structuredContent?JSON.stringify(result.structuredContent,null,2):'');
    if(!text)throw new AppError('Granola did not return any readable notes.');
    if(text.length>20000)throw new AppError('These notes are too long to share as one excerpt. Narrow your search.',413);
    return text;
  }
}
/** Keep a deliberately small supported schema surface; unknown requirements fail closed. */
export function validateInput(schema:any,value:any,path='filters'):void {
  if(schema.anyOf||schema.oneOf||schema.allOf||schema.$ref)throw new AppError('These Granola filters need a newer connection adapter.',502);
  if(value===null&&schema.type==='null')return;
  if(schema.enum&&!schema.enum.some((v:any)=>JSON.stringify(v)===JSON.stringify(value)))throw new AppError(`Choose a valid ${path}.`);
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  if(types.includes('object')) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError(`Choose valid ${path}.`);
    const properties=schema.properties||{};
    for(const name of schema.required||[])if(!(name in value))throw new AppError(`Enter ${name.replaceAll('_',' ')}.`);
    for(const [name,item] of Object.entries(value)){if(!properties[name])throw new AppError('An unsupported Granola filter was supplied.');validateInput(properties[name],item,name.replaceAll('_',' '));}
  } else if(types.includes('array')) {
    if(!Array.isArray(value)||value.length>100||(schema.minItems!==undefined&&value.length<schema.minItems)||(schema.maxItems!==undefined&&value.length>schema.maxItems))throw new AppError(`Choose valid ${path}.`);
    if(!schema.items)throw new AppError('These Granola filters need a newer connection adapter.',502);
    for(const item of value)validateInput(schema.items,item,path);
  } else if(types.includes('string')) {
    if(typeof value!=='string'||value.length>2000||(schema.maxLength!==undefined&&value.length>schema.maxLength)||(schema.minLength!==undefined&&value.length<schema.minLength))throw new AppError(`Enter valid ${path}.`);
  } else if(types.includes('integer')||types.includes('number')) {
    if(typeof value!=='number'||!Number.isFinite(value)||(types.includes('integer')&&!Number.isInteger(value))||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum))throw new AppError(`Enter valid ${path}.`);
  } else if(types.includes('boolean')) {if(typeof value!=='boolean')throw new AppError(`Choose valid ${path}.`);}
  else throw new AppError('These Granola filters need a newer connection adapter.',502);
}
