import { env } from 'cloudflare:workers';
import { service } from '@/lib/service';
import { Granola } from '@/lib/granola';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  let success=false;
  try{await new Granola(await service(),env.ACCORD_CONNECTION_ENCRYPTION_KEY).complete(params.get('state')||'',params.get('code')||'',params.has('error'));success=true;}
  catch(error){console.error('Granola sign-in did not complete',{kind:error instanceof Error?error.name:'UnknownError'});}
  // Never echo upstream codes, tokens, errors or redirects into the page or its URL.
  return new Response(null,{status:303,headers:{Location:`/?view=connections&granola=${success?'connected':'not_connected'}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
