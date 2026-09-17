import { describe, expect, it } from 'vitest';
import reducer, { receiveAccount, invalidateAccount } from '../slices/paperSlice';
import { accountRisk } from '@/lib/paperRisk';
import { PaperAccountSchema } from '@/schemas/paper';
const account = PaperAccountSchema.parse({ epoch: 'a', revision: 2, initialCash: 100000, cash: 99900, realizedPnl: 50, fees: 2, paused: false, orders: [], executions: [], positions: [] });
describe('paper reconciliation and risk', () => {
  it('does not roll back newer socket state when an older HTTP acknowledgement arrives', () => {
    const current = reducer(undefined, receiveAccount(account));
    expect(reducer(current, receiveAccount({ ...account, revision: 1, cash: 0 })).account?.cash).toBe(99900);
    expect(reducer(current, invalidateAccount()).synchronized).toBe(false);
    expect(reducer(current, receiveAccount(account)).synchronized).toBe(true);
  });
  it('accepts a new server epoch after restart', () => {
    expect(reducer(reducer(undefined, receiveAccount(account)), receiveAccount({ ...account, epoch: 'b', revision: 0 })).account?.epoch).toBe('b');
  });
  it('defines returns against initial equity and deducts fees', () => {
    const risk = accountRisk(account, {});
    expect(risk.pnl).toBe(48);
    expect(risk.returnPercent).toBeCloseTo(0.048);
    expect(risk.equity).toBe(100048);
  });
});
