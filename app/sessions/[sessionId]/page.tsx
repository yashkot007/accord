import WorkspaceApp from '../../workspace-app';
import { requireChatGPTUser } from '../../chatgpt-auth';
import '../../session-workspace.css';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await requireChatGPTUser(`/sessions/${encodeURIComponent(sessionId)}`);
  return <WorkspaceApp initialUser={{ id: user.userId, name: user.displayName, email: user.email }} initialSpaceId={sessionId} roomMode />;
}
