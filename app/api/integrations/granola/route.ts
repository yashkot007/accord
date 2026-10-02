import { env } from 'cloudflare:workers';
import { service } from '@/lib/service';
import { handleGranolaRequest } from '@/lib/granola-http';
import { Granola } from '@/lib/granola';
export const dynamic='force-dynamic';
async function integration(){return new Granola(await service(),env.ACCORD_CONNECTION_ENCRYPTION_KEY);}
export async function GET(request:Request){return handleGranolaRequest(request,integration);}
export async function POST(request:Request){return handleGranolaRequest(request,integration);}
