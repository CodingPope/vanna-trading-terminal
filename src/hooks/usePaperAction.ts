import { useState } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { receiveAccount } from '@/store/slices/paperSlice';
import { paperRequest } from '@/services/paper';
export function usePaperAction() {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(path: string, method = 'POST', body?: unknown) {
    setBusy(true); setError('');
    try { dispatch(receiveAccount(await paperRequest(path, method, body))); return true; }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed. Reconcile before retrying.');
      try { dispatch(receiveAccount(await paperRequest())); } catch { /* Keep the visible error. */ }
      return false;
    } finally { setBusy(false); }
  }
  return { run, busy, error };
}
