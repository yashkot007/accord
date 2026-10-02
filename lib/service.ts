import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { AppError, Workspace } from './workspace';
export async function service() {
  const user = await getChatGPTUser();
  if (!user) throw new AppError('Sign in to use your workspace.', 401);
  if (!env.DB) throw new AppError('The workspace is temporarily unavailable. Your input has not been changed.', 503);
  return new Workspace(env.DB, { id: user.userId, email: user.email, name: user.displayName });
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status, headers:{'Cache-Control':'no-store'} });
  console.error('Workspace operation failed', {kind:error instanceof Error?error.name:'UnknownError'});
  return Response.json({ error: 'We could not save that change. Your input is still here; please try again.' }, { status: 503, headers:{'Cache-Control':'no-store'} });
}
