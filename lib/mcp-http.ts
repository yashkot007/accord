import { discardRequestBody, readBoundedText } from './request-body.ts';
import { isHeavyMcpRead, mcpAdmission, type McpAdmission } from './mcp-admission.ts';
import { mcpDiagnostics, type McpDiagnostics, type McpDiagnosticOutcome, type McpDiagnosticReason } from './mcp-diagnostics.ts';
import { AccordHost } from './host.ts';
import { agentTools } from './agent-tools.ts';
import { agentInstructions } from './agent-instructions.ts';
import { AppError, type Workspace } from './workspace.ts';

export const protocolVersions = ['2025-11-25', '2025-06-18'];
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const requestId = (value:unknown):value is string|number => typeof value==='string'||Number.isSafeInteger(value);
const noStore = {'Cache-Control':'no-store'};
const reply = (id:unknown,result:unknown) => Response.json({jsonrpc:'2.0',id,result},{headers:noStore});
const failure = (id:unknown,code:number,message:string,status=200) => Response.json({jsonrpc:'2.0',...(requestId(id)?{id}:{}),error:{code,message}},{status,headers:noStore});
const toolError = (id:unknown,message:string) => reply(id,{isError:true,content:[{type:'text',text:message}]});
const busy = (id:unknown) => {
  const response = failure(id,-32000,'Accord is busy. Wait at least one second, then retry with the same arguments and request reference.',429);
  response.headers.set('Retry-After','1');
  return response;
};
const diagnosticReason = (error:AppError,request:Request):McpDiagnosticReason => {
  if(error.status===400&&request.signal.aborted)return 'interrupted';
  if(error.status===408)return 'timeout';
  if(error.status===401)return 'authentication';
  if(error.status===403)return 'access_denied';
  if(error.status===404)return 'not_found';
  if(error.status===409)return 'conflict';
  if(error.status===503)return 'service_unavailable';
  return [400,413,415].includes(error.status)?'invalid_request':'other_application_error';
};

// Validate the server's fixed string/integer tool schemas before any service is resolved.
function inputError(definition:typeof agentTools[number],args:Record<string,unknown>):string|null {
  const schema=definition.inputSchema;
  if(Object.keys(args).some(key=>!Object.hasOwn(schema.properties,key)))return 'Unexpected tool argument. Use the published input schema.';
  for(const key of schema.required)if(!Object.hasOwn(args,key))return `Missing required argument: ${key}.`;
  for(const [key,value] of Object.entries(args)){
    const property=schema.properties[key];
    if(property.type==='string'){
      if(typeof value!=='string'||value.length<(property.minLength??0)||value.length>(property.maxLength??Infinity)||(property.enum&&!property.enum.includes(value)))return `Enter a valid ${key} using the published input schema.`;
    }else if(property.type==='integer'){
      if(!Number.isSafeInteger(value)||(value as number)<(property.minimum??-Infinity)||(value as number)>(property.maximum??Infinity))return `Enter a valid ${key} using the published input schema.`;
    }
  }
  return null;
}

/** The hosting adapter supplies identity; callers cannot supply or replace this resolver. */
export async function handleMcpPost(request:Request,resolveWorkspace:()=>Promise<Workspace>,admission:McpAdmission=mcpAdmission,diagnostics:McpDiagnostics=mcpDiagnostics) {
  let id:string|number|null=null;
  let releaseBody:(()=>void)|null=null,releaseTool:(()=>void)|null=null,releaseAccount:(()=>void)|null=null;
  let response:Response|undefined,diagnostic:ReturnType<McpDiagnostics['begin']>|undefined;
  try{diagnostic=diagnostics.begin();}catch{/* Diagnostics never control request handling. */}
  const trace=(action:(value:NonNullable<typeof diagnostic>)=>void)=>{try{if(diagnostic)action(diagnostic);}catch{/* Best effort only. */}};
  const respond=(make:()=>Response,outcome:McpDiagnosticOutcome,reason:McpDiagnosticReason|null=null,applicationStatus:number|null=null,stage:'body'|'tool'|'account'|null=null)=>{
    trace(value=>{value.result(outcome,reason,applicationStatus,stage);value.phase('serialize');});
    response=make();return response;
  };
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin){discardRequestBody(request);return respond(()=>failure(null,-32000,'Origin not allowed.',403),'transport_error','access_denied');}
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){discardRequestBody(request);return respond(()=>failure(null,-32600,'Expected application/json.',415),'transport_error','invalid_request');}
    const version=request.headers.get('MCP-Protocol-Version');
    if(version&&!protocolVersions.includes(version)){discardRequestBody(request);return respond(()=>failure(null,-32600,'Unsupported MCP protocol version.',400),'transport_error','invalid_request');}
    trace(value=>value.phase('admission'));
    releaseBody=admission.claimBody();
    if(!releaseBody){discardRequestBody(request);return respond(()=>busy(null),'transport_error','overload',null,'body');}
    trace(value=>value.phase('body'));
    const raw=await readBoundedText(request,128*1024,{timeoutMs:admission.limits.bodyTimeoutMs});
    trace(value=>value.phase('validate'));
    let message:unknown;try{message=JSON.parse(raw);}catch{return respond(()=>failure(null,-32700,'Invalid JSON.',400),'transport_error','invalid_request');}
    if(!record(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||!message.method)return respond(()=>failure(null,-32600,'Invalid request.',400),'transport_error','invalid_request');
    const method=message.method;
    trace(value=>value.select(method));
    const hasId=Object.hasOwn(message,'id');
    if(hasId&&!requestId(message.id))return respond(()=>failure(null,-32600,'Request ID must be a string or safe integer.',400),'transport_error','invalid_request');
    if(hasId)id=message.id as string|number;
    if(message.params!==undefined&&!record(message.params))return respond(()=>failure(id,-32602,'Parameters must be an object.',400),'transport_error','invalid_request');
    releaseBody();releaseBody=null;
    // One-way messages never invoke a tool or return a JSON-RPC response.
    if(!hasId){trace(value=>value.select('notification'));return respond(()=>new Response(null,{status:202,headers:noStore}),'notification');}
    const params=record(message.params)?message.params:undefined;
    if(message.method==='initialize'){
      if(!record(params)||typeof params.protocolVersion!=='string'||!params.protocolVersion||!record(params.capabilities)||!record(params.clientInfo)||typeof params.clientInfo.name!=='string'||!params.clientInfo.name||typeof params.clientInfo.version!=='string'||!params.clientInfo.version)return respond(()=>failure(id,-32602,'Initialization requires protocolVersion, capabilities, and clientInfo with name and version.'),'transport_error','invalid_request');
      const negotiatedVersion=protocolVersions.includes(params.protocolVersion)?params.protocolVersion:protocolVersions[0];
      return respond(()=>reply(id,{protocolVersion:negotiatedVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'accord',title:'Accord',version:'0.13.1'},instructions:agentInstructions}),'success');
    }
    if(message.method==='ping')return respond(()=>reply(id,{}),'success');
    if(message.method==='tools/list'){
      if(params?.cursor!==undefined)return respond(()=>failure(id,-32602,'This server returns its full tool list in one page; omit cursor.'),'transport_error','invalid_request');
      return respond(()=>reply(id,{tools:agentTools}),'success');
    }
    if(message.method!=='tools/call')return respond(()=>failure(id,-32601,'Method not found.'),'transport_error','invalid_request');
    if(!record(params)||typeof params.name!=='string')return respond(()=>failure(id,-32602,'Specify a tool name.'),'transport_error','invalid_request');
    const name=params.name;
    const definition=agentTools.find(tool=>tool.name===name);
    if(!definition)return respond(()=>failure(id,-32602,'Unknown tool.'),'transport_error','invalid_request');
    trace(value=>value.select('tools/call',definition.name));
    const args=Object.hasOwn(params,'arguments')?params.arguments:{};
    if(!record(args))return respond(()=>failure(id,-32602,'Tool arguments must be an object.'),'transport_error','invalid_request');
    const invalid=inputError(definition,args);if(invalid)return respond(()=>toolError(id,invalid),'tool_error','invalid_request',400);
    if(request.signal.aborted)throw new AppError('This request was interrupted. Please try again.',400);
    trace(value=>value.phase('admission'));
    releaseTool=admission.claimTool(isHeavyMcpRead(name,args));
    if(!releaseTool)return respond(()=>busy(id),'transport_error','overload',null,'tool');
    trace(value=>value.phase('auth'));
    const workspace=await resolveWorkspace();
    if(request.signal.aborted)throw new AppError('This request was interrupted. Please try again.',400);
    trace(value=>value.phase('admission'));
    releaseAccount=admission.claimAccount(workspace.user.id);
    if(!releaseAccount)return respond(()=>busy(id),'transport_error','overload',null,'account');
    trace(value=>value.phase('tool'));
    try{
      const host=new AccordHost(workspace);
      const result=name==='list_sessions'?await host.agentSessions(args):['arrive_at_accord','consult_host','enter_room','leave_accord'].includes(name)?await host.perform(name,args,'agent'):await workspace.agentTool(name,args);
      return respond(()=>reply(id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}),'success');
    }catch(error){if(error instanceof AppError)return respond(()=>toolError(id,error.message),'tool_error',diagnosticReason(error,request),error.status);throw error;}
  }catch(error){
    if(error instanceof AppError)return respond(()=>failure(id,-32000,error.message,error.status),'transport_error',diagnosticReason(error,request),error.status);
    return respond(()=>failure(id,-32603,'The workspace is unavailable. Try again later.',503),'transport_error','unexpected_failure');
  }finally{
    // Do not expire leases or release on disconnect while dispatched work is still running.
    releaseAccount?.();releaseTool?.();releaseBody?.();
    trace(value=>value.finish(response));
  }
}
export const mcpMethodNotAllowed = () => new Response(null,{status:405,headers:{Allow:'POST',...noStore}});
