/**
 * ANA SSE streaming client.
 *
 * Connects to the ANA analysis backend via EventSource (SSE).
 * Each streamed chunk is Zod-validated before being forwarded to the caller.
 * Circuit breaker: pauses after 3 consecutive errors, retries after 30s.
 */
import { AnaStreamChunkSchema } from '@/schemas';
import type { AnaStreamChunk } from '@/schemas';
import type { AnaAnalysis } from '@/types';

export interface AnaStreamCallbacks {
  onToken: (token: string) => void;
  onAnalysis: (analysis: AnaAnalysis) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export class AnaStreamClient {
  private readonly baseUrl: string;
  private es: EventSource | null = null;
  private errorCount = 0;
  private readonly maxErrors = 3;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private currentSymbol = '';

  constructor(baseUrl: string = '/api/ana') {
    this.baseUrl = baseUrl;
  }

  connect(symbol: string, callbacks: AnaStreamCallbacks): void {
    if (this.destroyed) return;
    this.currentSymbol = symbol;
    this.es?.close();

    const url = `${this.baseUrl}/stream?symbol=${encodeURIComponent(symbol)}`;
    try {
      this.es = new EventSource(url);
    } catch {
      // No ANA backend available in demo mode — silently no-op
      return;
    }

    this.es.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string) as unknown;
        const result = AnaStreamChunkSchema.safeParse(raw);
        if (!result.success) {
          console.warn('[ANA] Invalid SSE chunk:', result.error.issues);
          return;
        }
        this.handleChunk(result.data, callbacks);
      } catch (err) {
        console.warn('[ANA] SSE parse error:', err);
      }
    };

    this.es.onerror = () => {
      this.es?.close();
      this.es = null;
      this.scheduleRetry(callbacks);
    };
  }

  private handleChunk(chunk: AnaStreamChunk, callbacks: AnaStreamCallbacks): void {
    switch (chunk.type) {
      case 'token':
        callbacks.onToken(chunk.content);
        break;
      case 'analysis':
        callbacks.onAnalysis(chunk.data);
        this.errorCount = 0;
        break;
      case 'done':
        callbacks.onDone();
        this.errorCount = 0;
        break;
      case 'error':
        callbacks.onError(chunk.message);
        this.scheduleRetry(callbacks);
        break;
    }
  }

  private scheduleRetry(callbacks: AnaStreamCallbacks): void {
    if (this.destroyed) return;
    this.errorCount++;

    if (this.errorCount >= this.maxErrors) {
      console.warn('[ANA] Circuit breaker open — retrying in 30s');
      this.retryTimer = setTimeout(() => {
        this.errorCount = 0;
        this.connect(this.currentSymbol, callbacks);
      }, 30_000);
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.connect(this.currentSymbol, callbacks);
    }, 2_000);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.es?.close();
    this.es = null;
  }
}
