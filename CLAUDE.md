# Working on BoardGame

Quick orientation for an AI/human agent making changes here. The full tech
design is in [MULTIPLAYER_DESIGN.md](MULTIPLAYER_DESIGN.md); this file is
the "what to do in practice" companion.

## Repo layout in one glance

```
src/
  shared/        Pure rules. Run on both server & client. NO DOM, NO Three.js.
    actions.ts     Action union — every player intent.
    events.ts     GameEvent union — every observable state change.
    reducer.ts    applyAction(action) → { ok, events } | { ok: false, error }
  engine/        Mutation helpers called by the reducer (still part of "shared
                 rules" — they read/write `state` and emit events).
  eventApplier/  Side-effects per event type (DOM, Three.js, animations).
                 Runs on the client only.
  network/       WebSocket client, ReconnectingSocket, identity in URL.
  server/        Bun WebSocket server. Hosts rooms, runs the reducer.
  three/, ui/, input/   Browser-only.
sandbox/         Standalone Three.js demo at /sandbox/. Not part of the game.
tests/           Bun unit tests (`bun test`). Engine + reducer only.
```

## The rule: server-authoritative, action → reducer → events

Every player intent goes through this path:

```
input handler
  └─▶ dispatch({ type: 'ACTION_NAME', ...payload })
       └─▶ network.send (action)
            └─▶ server: applyAction(action)
                 ├─▶ reducer routes to engine fn (mutates state, emits events)
                 ├─▶ flushEvents() drains the buffer
                 └─▶ broadcast { events } + { state_snapshot } to BOTH players
                      └─▶ client: applyEvents(events) runs side-effects
                           (DOM patches, Three.js animations, log lines)
                      └─▶ client: replaceLocalStateFrom(snapshot) replaces state
```

Three invariants follow from this:

1. **Engine code never touches DOM or Three.js directly.** It calls helpers
   (`addLog`, `syncBoardVisualState`, `playRifleShot`) that *emit events*.
   The real side-effect runs on the client in `eventApplier/`.
2. **Client never mutates `state` directly.** Mutation only happens via the
   server snapshot + applied events. Local UI state (selection, hover,
   targeting mode) lives in `state.mode` / `state.pending*` and is part of
   the snapshot the server broadcasts.
3. **Random happens on the server.** Anything reading `Math.random()` for
   gameplay (deck shuffle, IDs) runs inside the reducer. Decorative
   randomness in `eventApplier/` particles is fine.

## Adding a new feature — the checklist

Most features follow the same shape. To add **a new ability or action**:

1. **Define the action** in [src/shared/actions.ts](src/shared/actions.ts).
   Keep payloads flat and self-contained — server must be able to replay the
   action with no client-only context.

2. **Define any new events** in [src/shared/events.ts](src/shared/events.ts).
   One event per *observable change* (UNIT_DAMAGED, BUILDING_UPGRADED). Avoid
   coarse "state changed" events — they collapse the per-event animation
   targeting in the applier.

3. **Implement the engine function** under `src/engine/`. It should:
   - Read/write `state` (the singleton).
   - Validate game rules; on rejection just `addLog(...)` and `return`.
   - Emit events for every observable mutation via `emit({ type: 'X', ...})`.
   - Call `addLog`, `syncBoardVisualState`, `renderUI` as if they were direct
     side-effects — they're shimmed to push events.

4. **Wire the action into the reducer** in
   [src/shared/reducer.ts](src/shared/reducer.ts) — one `case` that calls
   the engine function and returns `{ ok: true, events: [] }`.

5. **Add a handler in `eventApplier/`** for any new event types (under the
   right domain file: `unitEvents`, `effectEvents`, `buildingEvents`, etc.).
   The exhaustiveness check in
   [src/eventApplier/index.ts](src/eventApplier/index.ts) will fail to
   compile if you add a new event type without a handler.

6. **Wire the UI** in [src/ui/renderUI.ts](src/ui/renderUI.ts) or an input
   handler under `src/input/`. Click → build action object →
   `dispatch(action)`.

7. **Test**. Add a Bun test under `tests/` that calls `applyAction` directly
   on a fresh game state and asserts on `events` + post-state. The full
   suite is 16 tests across 3 files (`combat`, `reducer`, `turnCycle`) and
   runs in ~170 ms — always run `npm test` before committing engine or
   reducer changes. Keep individual tests fast; no I/O, no THREE.

## Common gotchas

- **Local UI mode strings must match between engine and renderUI.** The
  engine sets `state.mode = '...'` to open a modal/picker; if the string
  doesn't match the renderUI check, the modal silently never opens. There
  was a real bug here: `'building_upgrade_selection'` vs
  `'building_upgrade_status_pick'`. The full set of valid modes lives in
  [src/types.ts](src/types.ts) — `GameMode`. Add new modes there, not as
  loose strings.

- **Don't broadcast hidden information.** Opponent's hand should be `null`
  placeholders. Today `state_snapshot` sends the full state to both — fix
  before turning on against strangers (it's fine for friends per the
  non-goals). When you do fix it, project per-recipient before the broadcast.

- **`setActiveContext(room.context)` before running the reducer on the
  server.** Multiple rooms each have their own state; the engine reads from
  a single "active" slot. The server already does this in `server.ts` — if
  you add a new server-side action handler, you must too.

- **Don't add a local fallback path for offline mode.** Stage E removed it.
  If `dispatch` is called and `network` isn't connected, it's logged and
  dropped — that's correct. There is no "offline single-player".

- **Three.js types must not leak into `shared/` or `engine/`.** Bun unit
  tests panic when THREE is imported on the test path (it tries to
  initialize WebGL). `src/three/coords.ts` exists exactly to keep
  `gridToWorld` out of `utils.ts`. Same rule for any new helper that
  touches `THREE.Vector3`.

- **Renaming an event = backward break for in-flight clients.** Cloud Run
  rolls forward instantly; if a client has an old bundle and the server
  starts sending a renamed event, the applier silently no-ops. Rename
  rarely; prefer additive changes during a session.

## Local development

```
npm run dev          # Vite dev server on http://localhost:5173 (client)
npm run server       # Bun WebSocket server on http://localhost:3001 (/ws)
                     # In dev, client connects to ws://localhost:3001/ws
                     # In prod, both are served from the same Cloud Run URL.

npm run build        # Vite production bundle into dist/
npm test             # Bun unit tests — 16 tests, ~170 ms. Run before every commit
                     # that touches src/shared/ or src/engine/.
npm run typecheck    # tsc --noEmit
```

To play multiplayer locally: open two browser windows on
`http://localhost:5173`, create a room in one, copy the room code, join
from the other.

## Deploy

`gcloud run deploy boardgame --source . --region europe-west1 --project boardgame-146898`

Cloud Build builds the [Dockerfile](Dockerfile) (two-stage Bun: `bun run build`
then runtime serving `dist/` + `/ws`). The single container serves the main
game, `/sandbox/`, and the WebSocket on the same port. See
[DEPLOY.md](DEPLOY.md) for full notes including session affinity and the
`--max-instances 1` constraint (rooms live in process memory).

## Style

- Strict TypeScript (`tsc --noEmit` is part of the loop).
- Event handlers: one event type per `case`; don't fall through.
- No comments that paraphrase the code. Comments explain *why*, not *what*.
- Don't add backwards-compat shims when changing the protocol — bump and
  redeploy. There's only one server and a handful of clients.
- Prefer editing existing files to adding new ones; the file count is
  already high enough for a 2-player pet project.
