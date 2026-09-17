import type { WebSocketClient } from './websocket';
let active: WebSocketClient | null = null;
export function registerFeed(client: WebSocketClient | null) { active = client; }
export function runFeedScenario(action: 'gap' | 'disconnect' | 'stale' | 'invalid' | 'burst', symbol: string) {
  active?.send({ type: 'demo', symbol, data: { action } });
}
