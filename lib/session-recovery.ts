export type SessionDraft = { name: string; purpose: string; code: string };
export type SessionAttempt = {
  key: string;
  view: 'start' | 'join';
  ownerId: string;
  input: Readonly<SessionDraft>;
  args: Readonly<Record<string, string>>;
  sessionId?: string;
};

/** Keep the original input and retry identity, including when the save reply is lost. */
export function sessionAttempt(view: 'start' | 'join', ownerId: string, input: SessionDraft, key: string): SessionAttempt {
  const draft = Object.freeze({ ...input });
  const values: Record<string, string> = view === 'start'
    ? { name: draft.name.trim(), topic: draft.purpose.trim().slice(0, 80), purpose: draft.purpose.trim(), request_id: key }
    : { code: draft.code.trim() };
  return { key, view, ownerId, input: draft, args: Object.freeze({ ...values, expected_owner_id: ownerId }) };
}

/** Choosing another attempt does not forget an earlier room or ambiguous save. */
export function retainSessionAttempt(earlier: SessionAttempt[], attempt: SessionAttempt) {
  return [...earlier.filter(item => item.key !== attempt.key), attempt];
}

export async function continueSessionAttempt(attempt: SessionAttempt, currentOwnerId: string, {
  request,
  receipt,
  enter,
}: {
  request: (action: string, args: Readonly<Record<string, string>>) => Promise<{ id: string }>;
  receipt: (saved: SessionAttempt) => void;
  enter: (id: string, expectedOwnerId: string) => Promise<void>;
}) {
  if (attempt.ownerId !== currentOwnerId) {
    throw new Error('Your signed-in account changed. Start or join another session with this account. Your earlier attempt is still available.');
  }
  let id = attempt.sessionId;
  if (!id) {
    const saved = await request(attempt.view === 'start' ? 'create_space' : 'join_space', { ...attempt.args, expected_owner_id: attempt.ownerId });
    id = saved.id;
    // Record a known save before the fresh membership check or navigation can fail.
    receipt({ ...attempt, sessionId: id });
  }
  await enter(id, attempt.ownerId);
}
