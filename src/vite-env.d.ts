/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket endpoint when the API is on another host, e.g. wss://vanna-api.fly.dev/ws. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
