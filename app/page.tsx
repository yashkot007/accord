import SessionRoom from './session-room';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <SessionRoom userId={user.userId} />;
}
