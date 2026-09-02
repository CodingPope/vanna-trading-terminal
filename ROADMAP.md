# VANNA Roadmap

Working checklist to take the repo from "looks abandoned" to front-office credential.
Verified against `main` on 2026-09-02 (commit `99258c9`).

**Audience test:**
- 30-second recruiter test: green CI badge, working demo link, README with a screenshot.
- 10-minute HM test: chaos toggle demo and the full order lifecycle.

Build for exactly those two. Skip everything else.

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

- [ ] **Rewrite the README.** It is still Vite boilerplate with one sentence changed.
      This is the highest-ROI file in the repo.
  - [ ] Screenshot or GIF of the terminal running, at the top
  - [ ] Live demo link
  - [ ] Architecture diagram of the data path
  - [ ] Short "why these choices" section: snapshot-then-delta, sequence validation,
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

- [ ] **Test the WebSocket client.** `services/websocket.ts` is the most interesting
      code in the repo and the only untested code. Use `mock-socket` or fake timers.
  - [ ] Backoff sequence: 1s, 2s, 4s, capped at 30s
  - [ ] Sequence gap triggers `subscribe` with `requestSnapshot: true`
  - [ ] Backpressure queue drops low-priority messages under load

---

## Tier 3: Credibility polish

Target: 2 to 3 days.

- [ ] **Delete one of the two UI state layers.** `UIContext.tsx` (280 lines, Context +
      useReducer, used by 20 files) and `uiStore.ts` (143 lines, Zustand, used by 1 file)
      hold near-identical shapes. Keep Zustand, migrate the 20, delete the Context.
      An abandoned half-migration reads worse than either choice alone.

- [ ] **Kill the `MarketStore` Context bridge.** It self-describes as a
      "backward-compatible Context bridge over Redux Toolkit" and exposes
      `dispatch: React.Dispatch<any>` with an eslint-disable. Only `OrderBookPanel` and
      `PositionsPanel` call `useSelector`; the other ten panels re-render on every market
      change. RTK and Reselect were installed to avoid exactly this and then routed around.

- [ ] **Replace the fabricated stats.** `websocket.ts` dispatches a hardcoded
      `fps: 60, renderTime: 0` on every pong, and the UI displays it as measured.
      Wire to a real rAF counter and `PerformanceObserver`, or delete the fields.
      Hardcoded metrics shown as real destroy trust in every other number on screen.

- [ ] **Regenerate or delete `VANNA_STACK.md`.** It marks Vitest, RTK, Reselect, Zustand,
      AG Grid, Docker, CI/CD, Lighthouse CI, and the whole WebSocket section as not done.
      All of it is shipped. Anyone who reads it concludes the doc is decoration.

- [ ] **Decide what session VWAP means in `ChartPanel`.** Left untouched deliberately —
      it changes numbers on screen, so it is your call, not a lint fix. Both series skip
      every bar before the anchor, so `vwap` and `anchoredVwap` accumulate over exactly
      the same range and always plot identically; the two lines only ever draw on top of
      each other. Session VWAP most likely should accumulate from bar 0 regardless of the
      anchor. (The O(n²) inner loop that recomputed the anchored sum per bar is already
      gone — it is a single O(n) pass now, same output.)

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
