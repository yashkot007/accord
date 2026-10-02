import InnApp from './inn-app';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <InnApp initialUser={{ id: user.userId, name: user.displayName, email: user.email }} />;
}
