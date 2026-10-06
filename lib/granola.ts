import { AppError, field, Workspace, type Args } from './workspace.ts';
import { ProviderVault, digest, nonce } from './provider-crypto.ts';
import { boundedJson, GRANOLA_ISSUER, GRANOLA_MCP, GranolaMcp, GranolaRequestBudget, type Fetcher, type GranolaTool } from './granola-mcp.ts';

type Credential={client_id:string;access_token:string;refresh_token?:string;expires_at:number};
type ConnectionSnapshot={connection_id:string;credential:string};
const now=()=>new Date().toISOString();
const future=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString();
export class Granola {
  vault:ProviderVault;
  workspace:Workspace;private fetcher:Fetcher;
  constructor(workspace:Workspace,secret:string|undefined,fetcher:Fetcher=fetch){this.workspace=workspace;this.fetcher=fetcher;this.vault=new ProviderVault(secret,workspace.user.id);}
  private get user(){return this.workspace.user.id;}
  private stmt(sql:string,...args:any[]){return this.workspace.stmt(sql,...args);}
  private async connection(){return this.workspace.one("SELECT * FROM provider_connections WHERE owner_id=? AND provider='granola'",this.user);}
  async status(){const row=await this.connection();return {configured:this.vault.configured,status:row?.status||'not_connected',account_label:row?.account_label||null,updated_at:row?.updated_at||null};}
  private async sameConnection(id:string){const row=await this.connection();if(!row||row.status!=='connected'||row.connection_id!==id)throw new AppError('Your Granola connection changed. Refresh before continuing.',409);return row;}
  async start(origin:string,budget=new GranolaRequestBudget(18000)){
    if(!this.vault.configured)throw new AppError('Account connections are temporarily unavailable. Please try again later.',503);
    await this.stmt("INSERT INTO provider_connections (owner_id,provider,connection_id,status,version,updated_at) VALUES (?,'granola',?,'not_connected',0,?) ON CONFLICT(owner_id,provider) DO NOTHING",this.user,crypto.randomUUID(),now()).run();
    const generation=(await this.connection())!.version;
    await this.workspace.db.batch([
      this.stmt("UPDATE provider_oauth_flows SET status='expired',details=NULL WHERE owner_id=? AND expires_at<=? AND status IN ('pending','exchanging')",this.user,now()),
      this.stmt('DELETE FROM provider_import_drafts WHERE owner_id=? AND source_id IS NULL AND expires_at<=?',this.user,now())
    ]);
    const url=new URL(origin);if(url.protocol!=='https:')throw new AppError('Open Accord at its secure website before connecting Granola.');
    const recent=await this.workspace.one("SELECT count(*) AS count FROM provider_oauth_flows WHERE owner_id=? AND provider='granola' AND created_at>?",this.user,new Date(Date.now()-600000).toISOString());
    if(recent?.count>=5)throw new AppError('Too many sign-in attempts. Please wait a few minutes.',429);
    const resource=await boundedJson(this.fetcher,'https://mcp.granola.ai/.well-known/oauth-protected-resource/mcp',{},budget);
    if(resource.resource!==GRANOLA_MCP||!resource.authorization_servers?.includes(GRANOLA_ISSUER))throw new AppError('Granola changed its sign-in settings. Please try again after the connection is updated.',502);
    const metadata=await boundedJson(this.fetcher,`${GRANOLA_ISSUER}/.well-known/oauth-authorization-server`,{},budget);
    for(const [key,path] of [['authorization_endpoint','/oauth2/authorize'],['token_endpoint','/oauth2/token'],['registration_endpoint','/oauth2/register']])if(metadata[key]!==GRANOLA_ISSUER+path)throw new AppError('Granola changed its sign-in settings. Please try again after the connection is updated.',502);
    if(metadata.issuer!==GRANOLA_ISSUER||!metadata.code_challenge_methods_supported?.includes('S256')||!metadata.token_endpoint_auth_methods_supported?.includes('none'))throw new AppError('Granola requires a sign-in method Accord does not yet support.',502);
    const redirect_uri=origin+'/api/integrations/granola/callback';
    const registration=await boundedJson(this.fetcher,metadata.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Accord',redirect_uris:[redirect_uri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})},budget);
    if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_id.length>1000||(registration.token_endpoint_auth_method&&registration.token_endpoint_auth_method!=='none'))throw new AppError('Granola could not register this connection.',502);
    const state=nonce(),state_hash=await digest(state),verifier=nonce();
    const authorization=new URL(metadata.authorization_endpoint);authorization.search=new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri,state,scope:'mcp',resource:GRANOLA_MCP,code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
    const details=await this.vault.seal({verifier,client_id:registration.client_id,redirect_uri},'oauth:'+state_hash);
    budget.assertActive();
    await this.workspace.db.batch([
      this.stmt("UPDATE provider_oauth_flows SET status='cancelled',details=NULL WHERE owner_id=? AND provider='granola' AND status IN ('pending','exchanging') AND EXISTS (SELECT 1 FROM provider_connections WHERE owner_id=? AND provider='granola' AND version=?)",this.user,this.user,generation),
      this.stmt("INSERT INTO provider_oauth_flows (state_hash,owner_id,provider,details,status,created_at,expires_at) SELECT ?,?,'granola',?,'pending',?,? WHERE EXISTS (SELECT 1 FROM provider_connections WHERE owner_id=? AND provider='granola' AND version=?)",state_hash,this.user,details,now(),future(10),this.user,generation)
    ]);
    const saved=await this.workspace.one("SELECT status FROM provider_oauth_flows WHERE state_hash=? AND owner_id=?",state_hash,this.user);
    if(saved?.status!=='pending')throw new AppError('Your Granola connection changed. Start sign-in again.',409);
    return {authorization_url:authorization.toString()};
  }
  private async token(parameters:Record<string,string>,budget:GranolaRequestBudget,fetcher:Fetcher=this.fetcher):Promise<Credential>{
    const result=await boundedJson(fetcher,GRANOLA_ISSUER+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,resource:GRANOLA_MCP})},budget);
    if(typeof result.access_token!=='string'||!result.access_token||result.access_token.length>16000||String(result.token_type).toLowerCase()!=='bearer'||(result.refresh_token!==undefined&&(typeof result.refresh_token!=='string'||result.refresh_token.length>16000)))throw new AppError('Granola returned an invalid sign-in result.',502);
    const duration=result.expires_in===undefined?300:result.expires_in;
    if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>365*86400)throw new AppError('Granola returned an invalid sign-in expiry.',502);
    return {client_id:parameters.client_id,access_token:result.access_token,refresh_token:result.refresh_token,expires_at:Date.now()+duration*1000};
  }
  async complete(state:string,code:string,denied=false,budget=new GranolaRequestBudget(18000)){
    if(state.length>200||!state)throw new AppError('This Granola sign-in is no longer available. Start again.',409);
    const state_hash=await digest(state);
    const flow=await this.stmt("UPDATE provider_oauth_flows SET status='exchanging' WHERE state_hash=? AND owner_id=? AND provider='granola' AND status='pending' AND expires_at>? RETURNING *",state_hash,this.user,now()).first() as Record<string,any>|null;
    if(!flow)throw new AppError('This Granola sign-in is no longer available to your account. Start again.',409);
    try {
      if(denied)throw new AppError('Granola sign-in was cancelled. Your notes have not been shared.');
      if(!code||code.length>4000)throw new AppError('Granola did not complete sign-in. Start again.');
      const details=await this.vault.open<{verifier:string;client_id:string;redirect_uri:string}>(flow.details,'oauth:'+state_hash);
      const credential=await this.token({grant_type:'authorization_code',code,client_id:details.client_id,redirect_uri:details.redirect_uri,code_verifier:details.verifier},budget);
      const mcp=new GranolaMcp(credential.access_token,this.fetcher,budget);await mcp.initialize();const tools=await mcp.tools();
      if(!tools.some(t=>['list_meetings','query_granola_meetings','get_meetings'].includes(t.name)))throw new AppError('Granola did not allow access to meeting notes. Check your account settings.',403);
      const account=tools.find(t=>t.name==='get_account_info');
      const label=account&&!account.inputSchema.required?.length?(await mcp.call(account,{})).slice(0,1500):'Granola account authorized';
      const connection_id=crypto.randomUUID(),sealed=await this.vault.seal(credential,'credential:'+connection_id);
      budget.assertActive();
      await this.workspace.db.batch([
        this.stmt(`INSERT INTO provider_connections (owner_id,provider,connection_id,credential,account_label,status,version,updated_at)
          SELECT ?,'granola',?,?,?,'connected',0,? WHERE EXISTS (SELECT 1 FROM provider_oauth_flows WHERE state_hash=? AND owner_id=? AND status='exchanging' AND expires_at>?)
          ON CONFLICT(owner_id,provider) DO UPDATE SET connection_id=excluded.connection_id,credential=excluded.credential,account_label=excluded.account_label,status='connected',version=provider_connections.version+1,refresh_key=NULL,refresh_until=NULL,updated_at=excluded.updated_at`,this.user,connection_id,sealed,label,now(),state_hash,this.user,now()),
        this.stmt("UPDATE provider_oauth_flows SET status='completed',details=NULL WHERE state_hash=? AND owner_id=? AND status='exchanging' AND EXISTS (SELECT 1 FROM provider_connections WHERE owner_id=? AND connection_id=? AND status='connected')",state_hash,this.user,this.user,connection_id)
      ]);
      await this.sameConnection(connection_id);
      return this.status();
    }catch(e){await this.stmt("UPDATE provider_oauth_flows SET status='failed',details=NULL WHERE state_hash=? AND owner_id=? AND status='exchanging'",state_hash,this.user).run();throw e;}
  }
  async disconnect(){
    await this.workspace.db.batch([
      this.stmt("INSERT INTO provider_connections (owner_id,provider,connection_id,status,version,updated_at) VALUES (?,'granola',?,'disconnected',1,?) ON CONFLICT(owner_id,provider) DO UPDATE SET status='disconnected',credential=NULL,account_label=NULL,refresh_key=NULL,refresh_until=NULL,version=provider_connections.version+1,updated_at=excluded.updated_at",this.user,crypto.randomUUID(),now()),
      this.stmt("UPDATE provider_oauth_flows SET status='cancelled',details=NULL WHERE owner_id=? AND provider='granola' AND status IN ('pending','exchanging')",this.user),
      this.stmt('DELETE FROM provider_import_drafts WHERE owner_id=? AND source_id IS NULL',this.user)
    ]);
    return this.status();
  }
  private async requireSignIn(snapshot:ConnectionSnapshot) {
    // A late rejection must not erase a newer sign-in or a refresh in progress.
    const changed=await this.stmt("UPDATE provider_connections SET status='reauth_required',credential=NULL,account_label=NULL,refresh_key=NULL,refresh_until=NULL,version=version+1,updated_at=? WHERE owner_id=? AND provider='granola' AND connection_id=? AND credential=? AND status='connected' AND refresh_key IS NULL",now(),this.user,snapshot.connection_id,snapshot.credential).run();
    if(!changed.meta.changes)throw new AppError('Your Granola connection changed. Refresh before continuing.',409);
  }
  private async readProvider<T>(snapshot:ConnectionSnapshot,read:()=>Promise<T>) {
    try{return await read();}
    catch(error){if(error instanceof AppError&&error.status===401)await this.requireSignIn(snapshot);throw error;}
  }
  private async client(budget:GranolaRequestBudget){
    let row=await this.connection();if(!row||row.status!=='connected'||!row.credential)throw new AppError('Connect Granola before reading your notes.',409);
    let credential=await this.vault.open<Credential>(row.credential,'credential:'+row.connection_id);
    budget.assertActive();
    if(credential.expires_at<Date.now()+30000){
      if(!credential.refresh_token){await this.requireSignIn(row as ConnectionSnapshot);throw new AppError('Granola needs you to sign in again.',401);}
      const previous=row.credential;
      if(row.refresh_key){
        if(row.refresh_until&&row.refresh_until>now())throw new AppError('Granola sign-in is being refreshed. Please try again shortly.',409);
        // An abandoned worker may already have rotated the token; an expired lease is not permission to retry it.
        const invalidated=await this.stmt("UPDATE provider_connections SET status='reauth_required',credential=NULL,account_label=NULL,refresh_key=NULL,refresh_until=NULL,version=version+1,updated_at=? WHERE owner_id=? AND provider='granola' AND connection_id=? AND credential=? AND refresh_key=? AND (refresh_until IS NULL OR refresh_until<=?)",now(),this.user,row.connection_id,previous,row.refresh_key,now()).run();
        throw new AppError(invalidated.meta.changes?'Granola needs you to sign in again.':'Your Granola connection changed. Refresh before continuing.',invalidated.meta.changes?401:409);
      }
      const lease=crypto.randomUUID();
      const claimed=await this.stmt("UPDATE provider_connections SET refresh_key=?,refresh_until=? WHERE owner_id=? AND provider='granola' AND connection_id=? AND status='connected' AND credential=? AND refresh_key IS NULL",lease,future(1),this.user,row.connection_id,previous).run();
      if(!claimed.meta.changes)throw new AppError('Granola sign-in is being refreshed. Please try again shortly.',409);
      let dispatched=false;
      try{
        const refreshed=await this.token({grant_type:'refresh_token',refresh_token:credential.refresh_token,client_id:credential.client_id},budget,(url,init)=>{dispatched=true;return this.fetcher(url,init);});
        credential={...refreshed,refresh_token:refreshed.refresh_token||credential.refresh_token};
        const sealed=await this.vault.seal(credential,'credential:'+row.connection_id);
        const result=await this.stmt("UPDATE provider_connections SET credential=?,refresh_key=NULL,refresh_until=NULL,version=version+1,updated_at=? WHERE owner_id=? AND provider='granola' AND connection_id=? AND status='connected' AND credential=? AND refresh_key=?",sealed,now(),this.user,row.connection_id,previous,lease).run();
        if(!result.meta.changes)throw new AppError('Your Granola connection changed. Refresh before continuing.',409);
        row={...row,credential:sealed};
      }catch(e){
        if(dispatched){
          // A lost refresh response may have rotated the upstream token. Never retry it blindly.
          await this.stmt("UPDATE provider_connections SET status='reauth_required',credential=NULL,account_label=NULL,refresh_key=NULL,refresh_until=NULL,version=version+1,updated_at=? WHERE owner_id=? AND provider='granola' AND connection_id=? AND refresh_key=?",now(),this.user,row.connection_id,lease).run();
        }else{
          // No request reached the provider. Release only this lease and retain access.
          await this.stmt("UPDATE provider_connections SET refresh_key=NULL,refresh_until=NULL WHERE owner_id=? AND provider='granola' AND connection_id=? AND credential=? AND refresh_key=?",this.user,row.connection_id,previous,lease).run();
        }
        throw e;
      }
    }
    const mcp=new GranolaMcp(credential.access_token,this.fetcher,budget);
    const tools=await this.readProvider(row as ConnectionSnapshot,async()=>{await mcp.initialize();return mcp.tools();});
    await this.sameConnection(row.connection_id);
    return {mcp,tools,connection_id:row.connection_id,snapshot:row as ConnectionSnapshot};
  }
  async tools(budget=new GranolaRequestBudget(18000)){const client=await this.client(budget);return {tools:client.tools.filter(t=>t.name!=='get_account_info')};}
  async preview(a:Args,budget=new GranolaRequestBudget(18000)){
    const name=field(a,'tool',100);if(!['list_meetings','get_meetings','query_granola_meetings'].includes(name))throw new AppError('Choose a supported way to read meeting notes.');
    const parameters=a.parameters;if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new AppError('Choose valid meeting filters.');
    const client=await this.client(budget),tool=client.tools.find(t=>t.name===name);if(!tool)throw new AppError('Your Granola account does not offer this way of reading notes.',403);
    const count=await this.workspace.one('SELECT count(*) AS count FROM provider_import_drafts WHERE owner_id=? AND created_at>?',this.user,new Date(Date.now()-60000).toISOString());
    if(count?.count>=10)throw new AppError('Please wait before reading more notes.',429);
    const content=await this.readProvider(client.snapshot,()=>client.mcp.call(tool,parameters as Record<string,unknown>));await this.sameConnection(client.connection_id);
    const id=crypto.randomUUID(),timestamp=now(),payload=await this.vault.seal({content,tool:name,parameters,read_at:timestamp},'draft:'+id);
    budget.assertActive();
    const saved=await this.stmt(`INSERT INTO provider_import_drafts (id,owner_id,connection_id,content,created_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM provider_connections WHERE owner_id=? AND provider='granola' AND connection_id=? AND status='connected')`,id,this.user,client.connection_id,payload,timestamp,future(20),this.user,client.connection_id).run();
    if(!saved.meta.changes)throw new AppError('Your Granola connection changed. Refresh before continuing.',409);
    return {draft_id:id,content,read_at:timestamp,expires_at:future(20),tool:name};
  }
  async share(a:Args){
    const draft_id=field(a,'draft_id',100),space_id=field(a,'space_id',100),title=field(a,'title',120),content=field(a,'content',18500);
    const membership=await this.workspace.member(space_id),fingerprint=await digest(JSON.stringify({space_id,title,content}));
    const draft=await this.workspace.one('SELECT * FROM provider_import_drafts WHERE id=? AND owner_id=?',draft_id,this.user);
    if(!draft)throw new AppError('These notes are no longer available to your account. Read them again.',409);
    if(draft.source_id){if(draft.request_hash!==fingerprint||draft.shared_space_id!==space_id)throw new AppError('These notes were already shared with different content. Read them again to create another excerpt.',409);return {id:draft.source_id,replayed:true};}
    if(draft.expires_at<=now())throw new AppError('This preview has expired. Read the notes again before sharing.',409);
    await this.sameConnection(draft.connection_id);
    const record=await this.vault.open<{tool:string;read_at:string}>(draft.content,'draft:'+draft_id);
    const source_id=crypto.randomUUID(),timestamp=now();
    const stored=`${content}\n\n---\nSelected Granola excerpt · Retrieved ${record.read_at} · ${record.tool}\nImported copy; later changes in Granola do not automatically update this source.`;
    await this.workspace.db.batch([
      this.stmt(`INSERT INTO sources (id,space_id,title,content,kind,created_by,created_at)
        SELECT ?,?,?,?,'Meeting notes',?,? WHERE EXISTS (SELECT 1 FROM members WHERE space_id=? AND user_id=? AND membership_key=?)
        AND EXISTS (SELECT 1 FROM provider_import_drafts d JOIN provider_connections c ON c.connection_id=d.connection_id AND c.owner_id=d.owner_id AND c.provider='granola'
        WHERE d.id=? AND d.owner_id=? AND d.source_id IS NULL AND d.expires_at>? AND c.status='connected')`,source_id,space_id,title,stored,this.user,timestamp,space_id,this.user,membership.membership_key,draft_id,this.user,timestamp),
      this.stmt("INSERT INTO events (id,space_id,actor_id,kind,description,created_at) SELECT ?,?,?,'source','Shared a selected Granola excerpt',? WHERE EXISTS (SELECT 1 FROM sources WHERE id=?)",crypto.randomUUID(),space_id,this.user,timestamp,source_id),
      this.stmt("UPDATE provider_import_drafts SET source_id=?,shared_space_id=?,request_hash=?,content='' WHERE id=? AND owner_id=? AND source_id IS NULL AND EXISTS (SELECT 1 FROM sources WHERE id=?)",source_id,space_id,fingerprint,draft_id,this.user,source_id)
    ]);
    const saved=await this.workspace.one('SELECT source_id,shared_space_id,request_hash FROM provider_import_drafts WHERE id=? AND owner_id=?',draft_id,this.user);
    if(saved?.source_id&&saved.request_hash===fingerprint&&saved.shared_space_id===space_id)return {id:saved.source_id,replayed:saved.source_id!==source_id};
    throw new AppError('Your connection or space access changed. Refresh before sharing.',409);
  }
}
