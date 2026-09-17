import { z } from 'zod';

export const PaperOrderSchema = z.object({
  id: z.string(), clientOrderId: z.string(), symbol: z.string(),
  side: z.enum(['buy', 'sell']), orderType: z.enum(['limit', 'market']),
  quantity: z.number().int().positive(), limitPrice: z.number().positive().nullable(),
  timeInForce: z.enum(['GTC', 'IOC']),
  status: z.enum(['working', 'partially_filled', 'filled', 'canceled', 'rejected']),
  filledQuantity: z.number().int().nonnegative(), averageFillPrice: z.number().nonnegative(),
  createdAt: z.number(), updatedAt: z.number(), version: z.number().int().positive(),
  reason: z.string().nullable(),
});
export const ExecutionSchema = z.object({
  id: z.string(), orderId: z.string(), symbol: z.string(), side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive(), price: z.number().positive(), fee: z.number().nonnegative(), timestamp: z.number(),
});
export const PaperAccountSchema = z.object({
  epoch: z.string(), revision: z.number().int().nonnegative(),
  initialCash: z.number().positive(), cash: z.number(), realizedPnl: z.number(), fees: z.number().nonnegative(),
  paused: z.boolean(), orders: z.array(PaperOrderSchema), executions: z.array(ExecutionSchema),
  positions: z.array(z.object({ symbol: z.string(), quantity: z.number().int(), averageCost: z.number().positive() })),
});
export type PaperOrder = z.infer<typeof PaperOrderSchema>;
export type PaperAccount = z.infer<typeof PaperAccountSchema>;
export interface OrderDraft {
  clientOrderId: string; symbol: string; side: 'buy' | 'sell'; orderType: 'limit' | 'market';
  quantity: number; limitPrice: number | null; timeInForce: 'GTC' | 'IOC';
}
