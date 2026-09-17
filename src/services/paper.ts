import { PaperAccountSchema, type OrderDraft } from '@/schemas/paper';

let memorySession: string | undefined;
export function paperSession(): string {
  if (memorySession) return memorySession;
  try {
    const saved = sessionStorage.getItem('vanna:paper-session');
    memorySession = saved && /^[a-zA-Z0-9_-]{16,80}$/.test(saved) ? saved : crypto.randomUUID();
    sessionStorage.setItem('vanna:paper-session', memorySession);
  } catch { memorySession = crypto.randomUUID(); }
  return memorySession;
}

export async function paperRequest(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/paper${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Paper-Session': paperSession() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof error?.detail === 'string' ? error.detail : `Request rejected (${response.status}). Check the order inputs.`);
  }
  return PaperAccountSchema.parse(await response.json());
}
export const submitPaperOrder = (draft: OrderDraft) => paperRequest('/orders', 'POST', draft);
