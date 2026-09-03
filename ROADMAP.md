# VANNA Roadmap

Working checklist to take the repo from "looks abandoned" to front-office credential.
Verified against `main` on 2026-09-02 (commit `99258c9`).

**Audience test:**
- 30-second recruiter test: green CI badge, working demo link, README with a screenshot.
- 10-minute HM test: chaos toggle demo and the full order lifecycle.

Build for exactly those two. Skip everything else.

---

## Execution order

Agreed 2026-09-02. Deliberately **not** tier order. Everything that does not need a
backend happens first, because it makes the backend step smaller rather than larger.

The reasoning: `MarketStore.tsx` (292 lines) holds the Context bridge *and* the mock feed
in one file, so "kill the bridge" and "replace the mock" are the same surgery — done
separately you touch 9 panels twice. And because the mock already dispatches into the
Redux store, migrating those panels onto selectors does **not** depend on where the data
comes from. Do it against the mock today, and `MarketStore` shrinks to a thin feed
adapter; swapping mock → WebSocket later becomes a substitution, not a refactor.

Note the goal right now is not removing the mock — nothing can remove it before the
backend exists, or the app is dead. The goal is making it **swappable**.

**Phase A — frontend, no backend needed**
1. ~~Hygiene batch: delete dead `Orb.tsx`, settle `VANNA_STACK.md`, bump GH actions to `@v5`~~ **done**
2. ~~Migrate the `useMarket` consumers onto selectors; shrink `MarketStore` to feed-only.~~
   **done** — it was 15 call sites, not 9. `MarketStore.tsx` is gone, split into
   `store/hooks.ts`, `store/marketFeed.tsx` (the feed seam) and `store/constants.ts`.
3. ~~Replace the fabricated stats.~~ **done** — moved up from Tier 3. It does *not*
   resolve itself with the backend: fps and frame time are client-side metrics no server
   can supply, and `websocket.ts` would have replaced random-fake with constant-fake.
4. ~~Consolidate UI state (`UIContext` → Zustand).~~ **done** — 9 consumers, not 20, and
   `uiStore.ts` had *zero*. Deleting `UIProvider` also fixed `?` and Cmd+K, which were
   double-bound against `useKeyboard` and cancelling themselves out on the dashboard.
5. ~~WebSocket client tests (backoff, gap → re-snapshot, backpressure).~~ **done** — 17
   tests, mutation-checked. Backpressure turned out to be unreachable and was rewired to
   drain on a frame; see below.

**Phase B — backend**

6. FastAPI backend + `GET /api/snapshot` + WS, two-service compose
7. Swap the feed. `wsLatency` becomes a real measurement here.
8. Chaos toggle (gaps, disconnects, burst)
9. Order entry + blotter
10. Playwright happy path

**Deferred by choice:** deploy, screenshot, demo link. Not until the project is close to
done — the work so far is not visual, so there is nothing worth showing yet.

---

## Tier 1: Stop the bleeding

Target: 2 days. Nothing below this tier matters until all six are done, because right now
anyone who opens the Actions tab sees a red X before they read a line of code.

- [x] **Fix the build.** `yarn build` fails today. `tsc -b` type-checks `vitest.config.ts`,
      and vitest 2.1 bundles its own Vite that structurally conflicts with Vite 7.
      Both `ci.yml` and `lighthouse.yml` die at the Build step.
      Fix: `yarn up vitest@^3`, then merge `vitest.config.ts` into `vite.config.ts`
      with `/// <reference types="vitest/config" />` so there is one config and one Vite.
      Done: vitest on 3.2.7, single config, `vitest.config.ts` deleted. The build also
      needed `@testing-library/dom` — an unlisted peer dep of `@testing-library/react`
      that was never installed, which is what broke the test file's types.

- [x] **Fix lint.** 43 errors, so CI is red at step one. Two categories are real:
  - [x] `react-hooks/purity` (10): `Math.random()` during render in
        `Orb.tsx:122-125` and `LandingPage.tsx:30-34`. Fixed with `useState`
        lazy initializers holding a seeded particle array. Note `useMemo` does *not*
        satisfy this rule; `useState(() => ...)` does.
  - [x] `react-hooks/set-state-in-effect` (4): `CommandPalette.tsx` now resets via the
        render-time adjustment pattern; `Dashboard.tsx`'s `selectedWorkspace` mirror was
        deleted outright (it duplicated `state.currentWorkspaceId`); `use-mobile.ts` moved
        to `useSyncExternalStore`. `TradesPanel` no longer reseeds the whole tape on every
        price tick — it seeds on symbol change only.
  - [x] Cosmetic remainder: `react-refresh/only-export-components` scoped off for
        `src/components/ui/**` and `src/store/**`, `catch {}` in `panelsSlice.ts`,
        and the `any`s in `ChartPanel`/`Dashboard` replaced with real types.

- [x] **Standardize on yarn.** No `yarn.lock` is committed. `package-lock.json` is,
      and `ci.yml`, `lighthouse.yml`, and the `Dockerfile` all run `npm ci` against it.
      Installing with yarn locally means silent lockfile drift.
  - [x] `rm package-lock.json && yarn install`, commit `yarn.lock`
  - [x] Add `"packageManager": "yarn@<your version>"` and `"engines": { "node": ">=22" }`
  - [x] Both workflows: `cache: yarn` and `yarn install --frozen-lockfile` (Yarn 1)
  - [x] Dockerfile: `COPY package.json yarn.lock ./` then `yarn install --frozen-lockfile`
  - [x] Added a `.dockerignore` — there was none, so `COPY . .` was baking the host
        `node_modules` into the image

- [x] **Remove `kimi-plugin-inspect-react`.** `inspectAttr()` is the first plugin in
      `vite.config.ts`, injects inspector attributes into every element, and ships in
      the production bundle. It announces the project was built in an AI IDE.

- [x] **Rewrite the README.** It is still Vite boilerplate with one sentence changed.
      This is the highest-ROI file in the repo.
  - [ ] Screenshot or GIF of the terminal running, at the top — **still needed.** The
        README has a commented placeholder pointing at `docs/screenshot.png`; drop the
        file in and uncomment the line.
  - [ ] Live demo link — blocked on the deploy above.
  - [x] Architecture diagram of the data path (mermaid, renders on GitHub). It shows the
        streaming path as dashed/unwired, because that is the truth right now.
  - [x] Short "why these choices" section: snapshot-then-delta, sequence validation,
        backpressure. This is the interview conversation, pre-loaded.

- [ ] **Deploy it.** Railway or Fly. The Dockerfile and nginx config already exist and
      nothing is running. A trading terminal nobody can click is not a credential.

- [x] **Fix the CI typecheck step.** Found while doing the above: `npx tsc --noEmit` ran
      against the root `tsconfig.json`, which is `"files": []` plus project references.
      Without `-b`, references are not followed, so the step type-checked *nothing* and
      passed a file containing `const x: number = "not a number"`. Now `tsc -b --force`.

---

## Tier 2: The actual wow

Target: 1 to 2 weeks. These are the only two items that change a hiring decision.

- [ ] **Build the FastAPI backend.** `server/` with a synthetic feed, `GET /api/snapshot`,
      and Pydantic models mirroring the Zod schemas. Wire into `docker-compose.yml` so
      `docker compose up` gives a working two-service system.
      Why: the entire real-time layer has never run against a real socket.
      `SnapshotService` catches its own failure and logs "no backend, using mock data."
      The backoff has never backed off. The gap detection has never seen a gap.
      Every claim in that code is currently unproven.

- [ ] **Add a chaos toggle to the backend.** Inject sequence gaps, force disconnects,
      burst the message rate. This is the demo. Watching the client detect a gap and
      re-snapshot live is what turns a portfolio piece into an offer.
      Burst mode now has something to show: `client.droppedMessages` counts shed
      low-priority messages, and the queue sheds above roughly 15k msg/sec. Surface that
      counter in the stats footer when the chaos toggle lands.

- [ ] **Ship order entry and a blotter.** Zero matches today for `OrderEntry`,
      `placeOrder`, `submitOrder`, `blotter`. All twelve panels are read-only.
  - [ ] Optimistic local state with `pending` status
  - [ ] Server ack transitions to `working`
  - [ ] Streaming partial fills
  - [ ] Cancel and amend paths
  - [ ] Confirmation step above a notional threshold
  - [ ] Explicit error state when the ack never arrives

      Why: high-consequence transactional UX is what front-office teams screen hardest
      for, and it is the one gap on the skills list this project does not touch at all.

- [x] **Test the WebSocket client.** Done — 17 tests using a hand-rolled socket double
      rather than mock-socket, whose internal setTimeout delivery fights the fake timers
      the backoff tests need.
  - [x] Backoff sequence: 1s, 2s, 4s, capped at 30s, reset after a successful open
  - [x] Sequence gap triggers `subscribe` with `requestSnapshot: true`
  - [x] Backpressure queue drops low-priority messages under load — this required
        *fixing* it first. It was drained synchronously on every message, so it never
        held more than one item and could not shed at all.

---

## Tier 3: Credibility polish

Target: 2 to 3 days.

- [x] **Delete one of the two UI state layers.** Done. `uiStore.ts` turned out to have
      no consumers at all — the "1 file" was itself, since `useUIStore` contains the
      substring `useUI`. Kept Zustand (it already had persist, `closeAllModals` and named
      orb actions), migrated the 9 real `useUI()` consumers, deleted `UIContext.tsx`.

- [x] **Kill the `MarketStore` Context bridge.** Done. All 15 call sites now read
      through selectors; the provider reads entities via `store.getState()` so it no
      longer re-renders on ticks. Swapping the mock feed for the real transport is now a
      change to one function body in `store/marketFeed.tsx`.

- [x] **Replace the fabricated stats.** Done. `usePerformanceStats` measures fps and
      peak frame time from a real rAF counter; `setStats` merges a Partial so each
      producer reports only what it can measure; unmeasurable values render as "—".
      Five tests assert the numbers track actual frame timing.

- [ ] **Two fabrications remain in `StatsFooter`.** "MARKET OPEN / 09:30 - 16:00 ET" is a
      hardcoded string that says the same thing at 3am — derive it from the clock or drop
      it. And `isConnected` is set true by the mock feed, so the footer reads LIVE next to
      a Wifi icon with no socket behind it; resolve when the real feed lands.

- [x] **Regenerate or delete `VANNA_STACK.md`.** Deleted. README now covers what is
      built and why; ROADMAP covers what is next. A third overlapping doc is what let it
      rot in the first place.

- [ ] **Decide what session VWAP means in `ChartPanel`.** Left untouched deliberately —
      it changes numbers on screen, so it is your call, not a lint fix. Both series skip
      every bar before the anchor, so `vwap` and `anchoredVwap` accumulate over exactly
      the same range and always plot identically; the two lines only ever draw on top of
      each other. Session VWAP most likely should accumulate from bar 0 regardless of the
      anchor. (The O(n²) inner loop that recomputed the anchored sum per bar is already
      gone — it is a single O(n) pass now, same output.)

- [x] **Delete `src/components/Orb.tsx`.** Done — it was unreachable dead code.

- [ ] **One Playwright path:** land, enter terminal, place order, see fill.

- [ ] **Commit in small logical units from here on.** One squashed commit reads as a dump.

---

## Explicitly cut

Not because they are bad ideas. Because none of them change a hiring decision, and the
bandwidth is not there alongside the Walmart contract and SocialCircle.

- React Three Fiber migration of the orb
- MessagePack
- D3 heatmaps and correlation matrices
- Vim-style navigation
- SWC compiler swap
- Highcharts (Lightweight Charts is already in and sufficient)

---

## What is already good, and should be said out loud in the README

Do not undersell these. They are the reason the project is worth finishing.

- `services/websocket.ts`: exponential backoff, heartbeat with latency measurement,
  priority backpressure queue, sequence-gap detection that fires a re-snapshot request
- `services/anaStream.ts`: SSE client with a real circuit breaker
- Handler-based ingestion split from presentation (`services/handlers/`)
- AG Grid wired into the order book, Lightweight Charts in for candles
- Zod validation at the API boundary, TypeScript `strict: true`, 47 passing tests
- Docker multi-stage build, nginx SPA config, CI and Lighthouse CI workflows
