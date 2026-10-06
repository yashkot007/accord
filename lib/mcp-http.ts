import { readBoundedText } from './request-body.ts';
import { AccordHost } from './host.ts';
import { agentTools } from './agent-tools.ts';
import { agentInstructions } from './agent-instructions.ts';
import { AppError, type Workspace } from './workspace.ts';

export const protocolVersions = ['2025-11-25', '2025-06-18'];
const record = (value:unknown):value is Record<string,any> => !!value && typeof value==='object' && !Array.isArray(value);
const requestId = (value:unknown):value is string|number => typeof value==='string'||Number.isSafeInteger(value);
const noStore = {'Cache-Control':'no-store'};
const reply = (id:unknown,result:unknown) => Response.json({jsonrpc:'2.0',id,result},{headers:noStore});
const failure = (id:unknown,code:number,message:string,status=200) => Response.json({jsonrpc:'2.0',...(requestId(id)?{id}:{}),error:{code,message}},{status,headers:noStore});
const toolError = (id:unknown,message:string) => reply(id,{isError:true,content:[{type:'text',text:message}]});

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
export async function handleMcpPost(request:Request,resolveWorkspace:()=>Promise<Workspace>) {
  let id:string|number|null=null;
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return failure(null,-32000,'Origin not allowed.',403);
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return failure(null,-32600,'Expected application/json.',415);
    const raw=await readBoundedText(request,128*1024);
    let message:unknown;try{message=JSON.parse(raw);}catch{return failure(null,-32700,'Invalid JSON.',400);}
    if(!record(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||!message.method)return failure(null,-32600,'Invalid request.',400);
    const hasId=Object.hasOwn(message,'id');
    if(hasId&&!requestId(message.id))return failure(null,-32600,'Request ID must be a string or safe integer.',400);
    if(hasId)id=message.id;
    if(message.params!==undefined&&!record(message.params))return failure(id,-32602,'Parameters must be an object.',400);
    const version=request.headers.get('MCP-Protocol-Version');
    if(version&&!protocolVersions.includes(version))return failure(id,-32600,'Unsupported MCP protocol version.',400);
    // One-way messages never invoke a tool or return a JSON-RPC response.
    if(!hasId)return new Response(null,{status:202,headers:noStore});
    const params=message.params;
    if(message.method==='initialize'){
      if(!record(params)||typeof params.protocolVersion!=='string'||!params.protocolVersion||!record(params.capabilities)||!record(params.clientInfo)||typeof params.clientInfo.name!=='string'||!params.clientInfo.name||typeof params.clientInfo.version!=='string'||!params.clientInfo.version)return failure(id,-32602,'Initialization requires protocolVersion, capabilities, and clientInfo with name and version.');
      return reply(id,{protocolVersion:protocolVersions.includes(params.protocolVersion)?params.protocolVersion:protocolVersions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'accord',title:'Accord',version:'0.10.0'},instructions:agentInstructions});
    }
    if(message.method==='ping')return reply(id,{});
    if(message.method==='tools/list'){
      if(params?.cursor!==undefined)return failure(id,-32602,'This server returns its full tool list in one page; omit cursor.');
      return reply(id,{tools:agentTools});
    }
    if(message.method!=='tools/call')return failure(id,-32601,'Method not found.');
    if(!record(params)||typeof params.name!=='string')return failure(id,-32602,'Specify a tool name.');
    const definition=agentTools.find(tool=>tool.name===params.name);
    if(!definition)return failure(id,-32602,'Unknown tool.');
    const args=Object.hasOwn(params,'arguments')?params.arguments:{};
    if(!record(args))return failure(id,-32602,'Tool arguments must be an object.');
    const invalid=inputError(definition,args);if(invalid)return toolError(id,invalid);
    const workspace=await resolveWorkspace();
    try{
      const host=new AccordHost(workspace);
      const result=params.name==='list_sessions'?await host.agentSessions(args):['arrive_at_accord','consult_host','enter_room','leave_accord'].includes(params.name)?await host.perform(params.name,args,'agent'):await workspace.agentTool(params.name,args);
      return reply(id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});
    }catch(error){if(error instanceof AppError)return toolError(id,error.message);throw error;}
  }catch(error){
    if(error instanceof AppError)return failure(id,-32000,error.message,error.status);
    console.error('Agent request failed',{kind:error instanceof Error?error.name:'UnknownError'});
    return failure(id,-32603,'The workspace is unavailable. Try again later.',503);
  }
}
export const mcpMethodNotAllowed = () => new Response(null,{status:405,headers:{Allow:'POST',...noStore}});
