# VANNA Technical Stack Checklist (Quant UI Engineering Standard)

Alignment of this app against the VANNA stack. Use this for implementation order and interview talking points.

---

## 1. Core Frontend Foundation

| Item | Status | Notes |
|------|--------|-------|
| React 18+ with Strict Mode | ✅ | React 19.2, `<StrictMode>` in `main.tsx` |
| TypeScript 5.9 (strictest) | ✅ | `~5.9.3`, `strict: true` in `tsconfig.app.json` |
| Vite or Esbuild | ✅ | Vite 7.2 (fast builds) |
| SWC compiler | ⏳ | Optional: add `@vitejs/plugin-react-swc` for SWC instead of Babel path |

**Installed:** `@reduxjs/toolkit`, `react-redux`, `reselect`, `zustand`, `immer`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `framer-motion`, `react-hotkeys-hook`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

**Next:** Add `useTransition` / `useDeferredValue` for non-urgent updates (e.g. ANA analysis) when wiring real data.

---

## 2. State Management (Critical for Trading Apps)

| Item | Status | Notes |
|------|--------|-------|
| Redux Toolkit 2.0 (normalized state) | ❌ | Currently React Context + useReducer in `MarketStore` / `UIStore` |
| Reselect (memoized selectors) | ❌ | Add with RTK (week 1–2) |
| Zustand (local UI state) | ❌ | For glass panel positions, sidebar toggles; can replace or complement UIStore |
| Immer (immutable updates) | ❌ | RTK includes Immer |
| State hydration for WebSocket reconnects | ❌ | Plan when adding WebSocket layer |

**Priority:** Week 1–2 – introduce RTK with normalized order book state; keep or migrate UI state to Zustand.

---

## 3. Real-Time Data Architecture

| Item | Status | Notes |
|------|--------|-------|
| Native WebSocket API (not Socket.IO) | ❌ | To implement |
| Handler-based architecture | ❌ | Separate ingestion from presentation |
| EventSource/SSE for ANA streaming | ❌ | Keep AI stream separate from market data |
| Reconnect (exponential backoff, heartbeat) | ❌ | |
| Snapshot + Delta (REST snapshot → WS deltas) | ❌ | |
| Sequence number validation / replay | ❌ | |
| Backpressure (drop non-critical during spikes) | ❌ | |
| Circular buffers for trade history | ❌ | Fixed-size to avoid memory growth |

**Priority:** Week 1–2 – WebSocket + normalized store first.

---

## 4. Financial Visualization

| Item | Status | Notes |
|------|--------|-------|
| AG Grid Enterprise (order books) | ❌ | Column virtualization, row buffering, cell flash (week 3) |
| Highcharts Stock or TradingView Lightweight | ⏳ | Currently Recharts; consider swap for candlesticks/volume (week 4) |
| D3 (custom heatmaps/correlation only) | ❌ | Add only if needed |
| React Three Fiber (3D orb) | ❌ | Orb is raw Three.js; migrate to R3F (week 5–6) |
| @react-three/drei | ❌ | With R3F |

**Current:** `DisplacementOrb.tsx` uses Three.js + custom vertex displacement shaders; `ChartPanel` uses Recharts.

---

## 5. 3D / VANNA Orb

| Item | Status | Notes |
|------|--------|-------|
| Three.js + custom shaders | ✅ | Vertex displacement + noise in `DisplacementOrb.tsx` |
| React Three Fiber | ❌ | Migrate orb to declarative R3F (week 5–6) |
| Zustand for 3D state (rotation, zoom) | ❌ | Independent from market state |
| Post-processing (bloom, noise) | ❌ | `@react-three/postprocessing` |
| InstancedMesh for particle clouds | ❌ | If multi-asset visualization |

---

## 6. Performance (60fps Target)

| Item | Status | Notes |
|------|--------|-------|
| React.memo (OrderBookRow, TradeFeedItem) | ❌ | Add when real feed exists |
| useMemo (spread, P&L) | ⏳ | Use where derived data is heavy |
| useTransition (non-urgent updates) | ❌ | For ANA / scanner |
| useDeferredValue (filtering/sorting) | ❌ | Scanner results |
| Virtualization (react-window or AG Grid) | ❌ | AG Grid covers order book |
| rAF throttling for charts | ❌ | Cap at 60fps |
| Object pooling (price ticks) | ❌ | Reduce GC |
| Web Workers (indicators, correlation) | ❌ | |
| CSS containment (glass panels) | ⏳ | Add `contain: layout paint` where appropriate |
| GPU (transform3d for price flash) | ❌ | |

---

## 7. UI/UX (Glasshouse + Terminal)

| Item | Status | Notes |
|------|--------|-------|
| CSS Modules or Styled-Components | ⏳ | Tailwind + global CSS; can add CSS Modules per panel |
| Framer Motion (glass panel drag) | ❌ | Add for panel animations |
| Radix UI / Headless UI | ✅ | Radix primitives in `components/ui` |
| CSS Grid/Flexbox | ✅ | Layout in place |
| Glassmorphism (backdrop-filter, semi-transparent) | ⏳ | Can standardize in theme |
| Dark mode (#0a0a0f, #ffdd88 accents) | ⏳ | next-themes present; enforce palette |

---

## 8. Keyboard-First

| Item | Status | Notes |
|------|--------|-------|
| React Hotkeys Hook or useKeyboardShortcuts | ⏳ | `KeyboardShortcuts.tsx` exists; align with checklist |
| Focus management (modals, focus indicators) | ⏳ | Radix helps; audit traps and visibility |
| Command palette (CMD+K) | ✅ | cmdk in `CommandPalette.tsx` |
| Vim-style (J/K, Space, Enter) | ❌ | Add for scanner / focus list (week 8) |
| Prevent default on critical shortcuts (e.g. F5) | ❌ | |

---

## 9. Type Safety & Validation

| Item | Status | Notes |
|------|--------|-------|
| Zod (ANA responses, API boundaries) | ✅ | Zod in package.json; use for all AI/API schemas |
| Discriminated unions (OrderStatus, etc.) | ⏳ | Enforce in `@/types` |
| Template literal types (e.g. EURUSD) | ❌ | Add for pair formats |
| Mapped types (UI state from market schemas) | ⏳ | As needed |
| Strict null checks | ✅ | Via `strict: true` |

---

## 10. Backend Integration

| Item | Status | Notes |
|------|--------|-------|
| FastAPI (Python) | N/A | Backend choice |
| Native WebSocket (not Socket.IO) | ❌ | Front-end to implement |
| Pydantic (Python) + Zod (front-end) | N/A | Pair schemas |
| MessagePack (optional) | ❌ | If latency demands |
| REST snapshots + WebSocket deltas | ❌ | |

---

## 11. Testing & Quality

| Item | Status | Notes |
|------|--------|-------|
| Vitest | ❌ | Add for unit tests |
| React Testing Library | ❌ | Component tests |
| Playwright (E2E, WebSocket scenarios) | ❌ | |
| TypeScript strict | ✅ | |
| ESLint @typescript-eslint/strict-type-checked | ⏳ | Add strict TS rules |

---

## 12. DevOps / Portfolio

| Item | Status | Notes |
|------|--------|-------|
| Docker | ❌ | Containerize app |
| GitHub Actions (CI/CD) | ❌ | |
| Vercel or Railway (live demo) | ❌ | |
| React DevTools Profiler (60fps proof) | ❌ | Document in README |
| Lighthouse CI (budgets) | ❌ | |

---

## Architecture Patterns (Interview Talking Points)

- **CQRS** – Separate read (order book queries) and write (order submission) paths.
- **Event Sourcing** – Replay WebSocket events to rebuild state; sequence numbers for replay.
- **Circuit Breaker** – Pause ANA/API calls on rate limit or repeated failures.
- **Observer / Pub-Sub** – Market data subscriptions driving multiple UI components.

---

## Red Flags to Avoid

- ❌ Redux with nested state (use normalized, flat structures).
- ❌ setState on every WebSocket tick (batch or throttle).
- ❌ Relaxed TypeScript (keep strict).
- ❌ Chat-style AI UI (use structured outputs + Zod).
- ❌ LocalStorage for session/sensitive state (memory or IndexedDB only).

---

## Priority Implementation Order

| Week | Focus |
|------|--------|
| 1–2 | WebSocket client + normalized Redux store (RTK), Reselect, reconnect + snapshot/delta |
| 3 | AG Grid order book (replace or augment current table) |
| 4 | Highcharts Stock or TradingView Lightweight Charts (candlesticks, volume) |
| 5–6 | React Three Fiber orb (migrate DisplacementOrb), Zustand for 3D + UI state |
| 7 | ANA integration with Zod-validated schemas, SSE streaming |
| 8 | Keyboard shortcuts (Vim-style, F5 handling, focus trap) |

---

*Last updated to match project state (Vite, React 19, TypeScript 5.9, Radix, cmdk, Zod, Three.js orb).*
