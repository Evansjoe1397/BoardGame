# Multiplayer Tech Design

This document describes the architecture for adding online 2-player multiplayer to BoardGame. It is written for an unfamiliar engineer joining the project — assume no prior context.

## 1. Context

- Current game: turn-based tactical drone combat, 10×18 grid, 2 players, hot-seat (one browser, both players take turns on the same screen).
- Stack: TypeScript, Vite, Three.js. ~30 modules, pure browser app, no server.
- Codebase already split into `data/`, `engine/`, `three/`, `input/`, `ui/`. State lives in a singleton (`src/state.ts`).
- Goal of this doc: turn this into 2-player online multiplayer over WebSocket without rewriting the game.

## 2. Goals & Non-goals

### Goals
- Two players in different browsers play one match in real time.
- Server is authoritative for game state and rule enforcement.
- Robust against connection drops, tab freeze, device sleep, and page reload.
- Same match can survive: a client closing the tab and reopening it from a bookmark.
- Minimal code duplication — game rules live in one place and run on both sides.
- Keep the existing game working locally during the migration (no big bang rewrite).

### Non-goals (explicitly out of scope for v1)
- Anti-cheat / hardened security. This is a pet project for friends. The level of trust we expect is "friends won't bother to mess with devtools".
- Spectators, tournaments, ratings, persistent accounts.
- More than 2 players per match.
- AI bots.
- Mobile-specific UX (works in mobile browser but not optimized).
- Rollback netcode / optimistic UI prediction. The game is turn-based; latency is fine.

## 3. Architecture Overview

We adopt a **server-authoritative model with action/event protocol**:

```
┌──────────┐                ┌──────────┐                ┌──────────┐
│ Client A │ ───action────▶ │  Server  │ ◀───action─── │ Client B │
│          │                │  (Bun)   │                │          │
│          │ ◀───events──── │          │ ───events───▶ │          │
└──────────┘                └──────────┘                └──────────┘
     │                            │                            │
     ▼                            ▼                            ▼
   shared engine            shared engine               shared engine
  (validate, apply)        (validate, apply)          (validate, apply)
```

- **Client** sends *intents* ("I want to play card 3 onto E5"), never mutated state.
- **Server** validates the intent against current state, runs the same engine the client runs locally, computes the new state, and broadcasts a list of typed *events* describing what happened.
- **Client** receives events and applies them to its own local copy of the state. The local state stays in sync with the server because every state mutation is driven by a server-issued event.
- The same TypeScript engine code runs on both sides (single source of truth for rules).

### Why action+events instead of full snapshots or diffs

| Option | Pros | Cons |
|--------|------|------|
| Full snapshot per change | Trivial sync logic; cannot drift | Each broadcast is ~10–20 KB; loses semantic info (what just happened?) |
| Computed diff | Bandwidth efficient | Diff calculation is non-trivial; loses "why" |
| **Typed events** | Small (~100–500 B); doubles as game log; trivial mapping to animations and UI updates; supports replays | Requires defining each event type explicitly |

For a turn-based card game, events win: bandwidth is fine, and the events are the single source of truth for both UI updates and animations.

### Why pessimistic UI (wait for server confirm)

Rollback netcode (apply locally, undo if server rejects) is the right choice for real-time games where every millisecond of input lag is felt. For a turn-based game, where one round of action is followed by a few seconds of animation anyway, server roundtrip latency (~50–100 ms over WebSocket) is invisible.

The flow per click is therefore: validate locally → send intent → block input → receive events from server → apply state → run animations → unblock input.

Local pre-validation is purely for UX (instantly highlighting valid move squares as the player hovers) — the server still re-validates on receipt.

## 4. Repository Structure

After Stage A of the migration, the layout is:

```
src/
├── shared/              # Pure game logic — no DOM, no Three.js, no I/O.
│   ├── types.ts         # Domain types (Unit, Building, GameState, etc.)
│   ├── actions.ts       # Action union (intents from client → server)
│   ├── events.ts        # Event union (server → clients)
│   ├── reducer.ts       # applyAction(state, action) → { state, events }
│   ├── queries.ts       # Pure read-only helpers (getValidMoveSquares, etc.)
│   ├── data/            # Card / Unit / Status / Building libraries (existing)
│   └── engine/          # Pure mutation helpers used by the reducer
├── client/              # Browser-only: Three.js, DOM, audio, input
│   ├── three/           # Scene, geometry, animations
│   ├── ui/              # DOM rendering, log
│   ├── input/           # Mouse/keyboard handlers; produce Actions
│   ├── network/         # WebSocket client, ReconnectingSocket
│   └── main.ts          # Entry point
└── server/              # Bun-only: WebSocket server, room manager
    ├── server.ts        # Entry point
    ├── room.ts          # Room class: state + connected players
    ├── roomManager.ts   # Match registry, lifecycle
    └── pingPong.ts      # Heartbeat
```

Both `client/` and `server/` import from `shared/`. The client browser bundle and the Bun server bundle each tree-shake out the half they don't need.

## 5. Action + Event Protocol

### 5.1 Actions (client → server)

An action is a typed message describing player intent. The server is the only consumer; clients do not exchange actions directly.

```typescript
type Action =
  | { type: 'PLAY_CARD'; cardIndex: number; targetSquareKey?: string; targetUnitId?: string }
  | { type: 'MOVE_UNIT'; unitId: string; targetSquareKey: string }
  | { type: 'ATTACK'; attackerId: string; targetUnitId?: string; targetSquareKey?: string }
  | { type: 'USE_ABILITY'; unitId: string; abilityKey: AbilityKey; ...targeting }
  | { type: 'PLACE_BUILDING'; buildingType: BuildingType; squareKey: string }
  | { type: 'UPGRADE_BUILDING'; buildingId: string; statusId: StatusId }
  | { type: 'CONFIRM_FOUNDATION'; ... }
  | { type: 'PROCESS_ECHO_STORE'; slot: ProcessEchoSlot; cardIndex: number }
  | { type: 'PROCESS_ECHO_PLAY'; slot: ProcessEchoSlot; ...targeting }
  | { type: 'END_TURN' };
```

The current input layer makes ~25 distinct operations against the engine. Each one becomes one action type. Targeting parameters are inlined into the action (no separate "enter targeting mode" action — that is a client-only UI state).

### 5.2 Events (server → clients)

An event describes a single observable change to the game state.

```typescript
type GameEvent =
  | { type: 'CARD_PLAYED'; player: PlayerId; cardId: CardId; squareKey?: string }
  | { type: 'UNIT_SUMMONED'; unit: Unit }
  | { type: 'UNIT_MOVED'; unitId: string; from: string; to: string; path: string[] }
  | { type: 'UNIT_DAMAGED'; unitId: string; damage: number; newHp: number; type: DamageType }
  | { type: 'UNIT_DESTROYED'; unitId: string; cause: 'attack' | 'effect' | 'overload' }
  | { type: 'BUILDING_PLACED'; building: Building }
  | { type: 'CARD_DRAWN'; toPlayer: PlayerId; cardId: CardId | null /* null = hidden */ }
  | { type: 'STATUS_APPLIED'; unitId: string; statusId: StatusId }
  | { type: 'TURN_STARTED'; player: PlayerId }
  | { type: 'TURN_ENDED'; player: PlayerId }
  | { type: 'ENERGY_CHANGED'; player: PlayerId; newEnergy: number }
  | { type: 'GAME_OVER'; winner: PlayerId }
  | { type: 'LOG'; message: string }
  ...
```

Events are emitted in the order they happen. The client applies them in order, optionally with a small delay between visually meaningful ones to let animations play out.

### 5.3 The reducer

```typescript
// src/shared/reducer.ts
export interface ReduceResult {
  ok: true;
  newState: GameState;
  events: GameEvent[];
}
export interface ReduceError { ok: false; error: string }

export function applyAction(
  state: GameState,
  action: Action,
  rng: () => number,
  actorPlayerId: PlayerId
): ReduceResult | ReduceError;
```

Properties:
- **Pure**: the function does not mutate `state`. It returns a new `GameState`. (Implementation can use Immer or manual cloning — Immer is fine for a project this size.)
- **Validates first**: if the action is illegal (wrong player's turn, not enough energy, target out of range, etc.), returns `{ ok: false, error }` and does not mutate.
- **Emits all observable side-effects as events**. No `addLog()`, no `syncBoardVisualState()`, no `playRifleShot()` from inside. Those become `LOG` and other events.
- **Takes RNG as a parameter** so the same reducer can be called with a deterministic RNG in tests.

### 5.4 Hidden information (fog of war)

Client A must not see Client B's hand. Two approaches:

1. **Per-recipient projection**: server keeps the full state, but before broadcasting, projects it for each recipient. Hidden cards become `{ cardId: null }` placeholders.
2. **Per-recipient event filtering**: when a `CARD_DRAWN` event is for player B, server sends `{ cardId: 'PAWN_DRONE' }` to B and `{ cardId: null }` to A.

We use approach 2 — it is local to the broadcast step. The client maintains its own state which simply has `null` placeholders for opponent's hand.

## 6. RNG Strategy

The server is authoritative, so all randomness happens on the server. The client never calls `Math.random()` for anything that mutates game state — it only receives event results.

Currently `Math.random()` is used in:
- `state.ts: createStarterDeck()` (deck shuffle on game start)
- `engine/turnManager.ts: drawCards()` (this just takes from top of pre-shuffled deck — not random per draw)
- `engine/buildings.ts: getRandomCompanyName()` and `nextUnitId()` / building ID

After migration: these calls move to the server (or to the reducer, which is server-side at runtime). The reducer accepts an `rng` parameter; in production the server constructs a `Math.random` wrapper, in unit tests we pass a seeded RNG so the same input always produces the same output.

Client-only `Math.random()` (particle randomness in effects, decorative jitter) is fine — these have no game-state impact.

**No shared seed between server and clients is needed**, because clients never run the random parts of the reducer. They only apply events that already encode the random results (e.g. `CARD_DRAWN` already names the card).

## 7. Identity, URL Routing, and Reconnection

### 7.1 Identity sources

```
┌──────────────────┬───────────────┬───────────────────────────────────┐
│ Storage          │ Per-tab?      │ Used for                          │
├──────────────────┼───────────────┼───────────────────────────────────┤
│ URL query string │ Yes (per URL) │ Source of truth for room+player   │
│ localStorage     │ No (shared)   │ Last nickname (UX prefill only)   │
│ sessionStorage   │ Yes           │ Not used (URL is more durable)    │
└──────────────────┴───────────────┴───────────────────────────────────┘
```

URL is the only storage that survives "close tab → reopen from bookmark or history" AND is per-tab (different tabs can have different URLs). Therefore identity lives in the URL.

### 7.2 URL format

```
https://boardgame.../?room=ABCD1234&pid=p_x7k2m9q
```

- `room`: 8-char room code, server-issued at room creation.
- `pid`: 16-char player token, **client-generated** on first join. Long enough to make collisions improbable, short enough to look reasonable in URLs. Acts as the player's identity for that room.

Token is in the URL, not in a cookie. Cookies would be shared across tabs of the same origin, which would prevent the "two tabs as different players" use case.

### 7.3 Lifecycle scenarios

**Create a room**
1. Home screen, user enters nickname → "Create room".
2. Client sends `{ type: 'create_room', nickname }`.
3. Server returns `{ roomId, pid }`. (Server can generate `pid` here, or client can — in v1 server generates it.)
4. Client `history.replaceState(null, '', '?room=ABCD1234&pid=p_x7k2m9q')`.
5. Server stores: `room ABCD1234 → players[{ pid, nickname, ws, disconnectedAt: null }]`.

**Join an existing room**
1. User opens a link `https://boardgame.../?room=ABCD1234` (no `pid`).
2. Client sees `room` in URL but no `pid` → shows "Enter your name".
3. User submits → client sends `{ type: 'join_room', roomId, nickname }`.
4. Server allocates a new `pid`, returns it.
5. Client writes `pid` into URL via `history.replaceState`.

**Second tab as a different player** (e.g. testing locally with self)
1. User opens a new tab to `https://boardgame.../?room=ABCD1234` (no `pid`).
2. Same flow as "join existing room" → new `pid`.
3. The two tabs have different URLs, so they hold different identities.
4. `localStorage.lastNickname` may suggest the same default name, but the user types whatever they want.

**Reload (F5)**
1. URL is unchanged (`?room=ABCD1234&pid=p_x7k2m9q`).
2. Client starts up, sees both room and pid → sends `{ type: 'rejoin', roomId, pid }`.
3. Server matches by `pid`, re-attaches the new WebSocket to the existing player slot, sends `state_snapshot`.

**Close tab and reopen from history/bookmark**
1. URL preserved → identical to reload.

**Leave game**
1. Click "Leave" → client sends `{ type: 'leave_room' }`, server cleans up that player slot.
2. Client clears URL via `history.pushState(null, '', '/')` and shows home screen.

### 7.4 Server-side disconnect grace period

When a WebSocket closes, the server does not immediately delete the player. It marks the slot as disconnected:

```typescript
ws.on('close', () => {
  const player = findPlayerByWs(ws);
  if (player) {
    player.ws = null;
    player.disconnectedAt = Date.now();
  }
});
```

A periodic cleanup loop (every ~30 seconds) deletes players whose `disconnectedAt` is older than the grace period (default 5 minutes). When the player count of a room hits zero, the room itself is removed.

If a `rejoin` arrives within the grace window, the player slot is recovered — `player.ws` and `player.disconnectedAt` are reset.

## 8. Connection Resilience

This addresses three orthogonal concerns: page reload (handled by URL+rejoin in §7), transport drop (handled here), and tab/device suspension (handled here).

### 8.1 Page lifecycle scenarios — what each one looks like

| Scenario | What happens | Detection | Action |
|----------|--------------|-----------|--------|
| F5, close+reopen, tab discard | Full page reload | (page just starts up) | Send `rejoin` on first connect |
| Wi-Fi drop, server restart, Cloud Run idle kill | TCP closed | `ws.onclose` fires | Reconnect with backoff |
| NAT timeout | TCP silently dropped, neither side knows | No event fires (zombie socket) | Application-level ping with timeout |
| Background tab throttle (~30 s+ in background) | `setInterval` runs at 1 Hz | (works through it) | Server-side WS ping keeps socket alive |
| Tab Freeze (Chrome, ~5 min in background) | All JS suspended; sockets usually die | `resume` event when user returns | Reconnect on `resume` |
| Tab Discard (memory pressure) | Page evicted from RAM | Page reload on return | (handled as page reload) |
| OS sleep (laptop closed) | Everything suspended | `visibilitychange` + `online` on wake | Reconnect, force ping |

### 8.2 Reconnecting WebSocket on the client

```typescript
class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private intentional = false;

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.attempt = 0;
      this.emit('connected');
    };
    this.ws.onclose = () => {
      this.emit('disconnected');
      if (this.intentional) return;
      const base = Math.min(30000, 1000 * 2 ** this.attempt);
      const jittered = base * (0.8 + Math.random() * 0.4);
      this.attempt++;
      setTimeout(() => this.connect(), jittered);
    };
  }

  close() { this.intentional = true; this.ws?.close(); }
}
```

- Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
- Jitter ±20% to avoid thundering herd if many clients reconnect simultaneously after a server restart.
- `attempt` resets on each successful connect.

### 8.3 Heartbeat (ping/pong)

Two layers:

**Server-side** (built-in WebSocket ping frames):
```typescript
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.__isAlive) { ws.terminate(); continue; }
    ws.__isAlive = false;
    ws.ping();
  }
}, 25_000);
ws.on('pong', () => { ws.__isAlive = true; });
```

The 25s interval keeps the socket below Cloud Run's idle timeout (which is 5 minutes for free tier and configurable up to 1 hour for paid tier).

**Client-side** (application-level ping, since the browser WebSocket API doesn't expose ping frames):
```typescript
let lastPongAt = Date.now();
setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'ping' }));
  setTimeout(() => {
    if (Date.now() - lastPongAt > 10_000) ws.close();
  }, 5_000);
}, 30_000);
// in onmessage: if (msg.type === 'pong') lastPongAt = Date.now();
```

If the server doesn't pong within 5 seconds of a ping, we assume the connection is a zombie and forcibly close it, which triggers the reconnect path.

### 8.4 Page Visibility / Lifecycle hooks

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (ws.readyState !== WebSocket.OPEN) reconnect();
    else sendPing();
  }
});

document.addEventListener('resume', () => reconnect());

window.addEventListener('online', () => reconnect());
window.addEventListener('offline', () => showOfflineBanner());
```

`visibilitychange` covers the most common case of a user returning to a tab after switching away. The `resume` event is Chrome-specific (Page Lifecycle API) and covers tab freeze. `online`/`offline` cover OS-level network changes.

### 8.5 UI feedback during disconnect

- A non-blocking banner: "Reconnecting…" with attempt counter.
- All input handlers check a `connected` flag and no-op when disconnected.
- After reconnect, the server sends a state snapshot, the client re-renders fully (animations are not preserved through disconnect — that's acceptable since the resulting state is correct).

### 8.6 What we explicitly skip in v1

- Buffered actions across disconnect (sending an action while offline, replaying after reconnect). For turn-based, blocking input is simpler and the user-visible difference is small.
- Event sequence numbers and incremental resync. A full snapshot on rejoin is simpler and handles all edge cases.
- Service Worker / IndexedDB persistence of state across page closes for offline play. We assume online-only.

## 9. Server Design (Bun)

### 9.1 Why Bun

- Native TypeScript without a build step (deploy `.ts` directly).
- Native WebSocket server (`Bun.serve`) — no `ws` package needed.
- Same npm ecosystem as Node.
- Container-ready, deploys to Cloud Run as easily as the existing Node setup.

### 9.2 Room model

```typescript
interface Room {
  id: string;                          // 8-char base32, e.g. "K7XQ2N8M"
  state: GameState;
  players: Map<string, Player>;        // pid → player
  hostPid: string;                     // first player; can start the game
  status: 'waiting' | 'playing' | 'ended';
  createdAt: number;
  rng: () => number;
}

interface Player {
  pid: string;
  nickname: string;
  playerId: PlayerId;                  // 'A' or 'B' assigned on join
  ws: WebSocket | null;                // null when disconnected
  disconnectedAt: number | null;
}
```

A `RoomManager` holds `Map<roomId, Room>` and provides:
- `createRoom(nickname, ws) → { roomId, pid, playerId }`
- `joinRoom(roomId, nickname, ws) → { pid, playerId } | error`
- `rejoinRoom(roomId, pid, ws) → ok | error`
- `applyAction(roomId, pid, action) → events | error`
- `cleanup()` — runs every 30s, removes stale disconnected players and empty rooms.

### 9.3 Message dispatch

The server routes incoming messages by `type`:

```typescript
ws.data = { roomId: null, pid: null };  // attached per-connection

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case 'create_room': /* ... */ break;
    case 'join_room':   /* ... */ break;
    case 'rejoin':      /* ... */ break;
    case 'action':      /* ... */ break;  // dispatches to reducer
    case 'leave_room':  /* ... */ break;
    case 'ping':        ws.send({ type: 'pong' }); break;
  }
});
```

When an `action` arrives:
1. Look up `room = rooms.get(ws.data.roomId)`.
2. Look up `player = room.players.get(ws.data.pid)`.
3. Run `result = applyAction(room.state, msg.action, room.rng, player.playerId)`.
4. If `result.ok === false`, send `{ type: 'action_rejected', error }` to the sender only.
5. Else, replace `room.state = result.newState`, then for each connected player in the room, send a projected `{ type: 'events', events }` (with hidden info filtered per recipient).

### 9.4 Persistence

None in v1. Rooms live in memory. If the server restarts, all in-progress matches are lost. This is acceptable for a pet project; matches are short (~10–20 minutes).

## 10. Client Design

### 10.1 Local state management

The client keeps a local `GameState` that mirrors the server's authoritative state. This local state is mutated only by applying server events. Direct UI interactions emit *actions* that go to the server.

We do not use React/Vue/etc. — the existing UI is direct DOM manipulation in `renderUI.ts`. We continue with that and add a small event bus:

```typescript
function applyEvent(event: GameEvent) {
  switch (event.type) {
    case 'UNIT_SUMMONED':
      state.units.push(event.unit);
      syncBoardVisualState();
      addLog(`Player ${event.unit.owner} summoned ${event.unit.unitName}`);
      break;
    case 'UNIT_DAMAGED':
      const unit = state.units.find(u => u.id === event.unitId);
      unit.hitPoints = event.newHp;
      playHitEffect(event.unitId);
      renderUI();
      break;
    // ...
  }
}
```

Animation triggers and UI updates live in the event handler, not in the engine. This is the inversion of the current architecture, where engine functions call `addLog`, `syncBoardVisualState`, `playHitEffect` directly.

### 10.2 Hand projection

The client's local state always represents what *this* player can see:
- Own hand: full card details.
- Opponent hand: an array of `null` placeholders (count is known, contents are not).

The server takes care of projecting the full state for each recipient before broadcasting.

### 10.3 Action submission flow

```
[user clicks an enemy unit while in attack-targeting mode]
       │
       ▼
[input handler builds: { type: 'ATTACK', attackerId, targetUnitId }]
       │
       ▼
[ActionDispatcher.send(action)]
       │
       ├── locally: validate against local state (for UX consistency only)
       │   if invalid → show error, abort
       │
       ├── set UI state to "waiting"
       │
       └── network.send({ type: 'action', action })

   ... server processes, broadcasts events ...

[network receives { type: 'events', events }]
       │
       ▼
[for each event: applyEvent(state, event), trigger animation if needed]
       │
       ▼
[UI state ← "ready"]
```

### 10.4 Network module

```
src/client/network/
├── ReconnectingSocket.ts    # connection + backoff + ping
├── MessageRouter.ts         # routes server messages to handlers
└── ActionDispatcher.ts      # sends actions, queues until connected
```

## 11. Migration Plan (Stages)

The migration is phased so the existing single-player game keeps working through each stage. Each stage ends with a runnable game.

### Stage A — Pure engine (no networking yet)
- Create `src/shared/`. Move `types.ts`, `state.ts`, `data/`, the data-only parts of `engine/` and `utils.ts` into it.
- Define `Action` and `GameEvent` unions in `shared/actions.ts` and `shared/events.ts`.
- Refactor engine functions to be pure: no calls to `addLog`, `syncBoardVisualState`, `renderUI`, or `play*` effect functions. Instead they emit events.
- Build `applyAction(state, action, rng, actor) → { newState, events } | { error }`.
- Wire a thin local `actionDispatcher.ts` on the client: input handlers create `Action` objects and run them through `applyAction` locally; an event handler applies events back to local state.
- The game keeps running locally with no server involved. Behavior is identical; the architecture is now ready for a server.

### Stage B — Bun WebSocket server
- Add `src/server/`. Implement `RoomManager`, `Room`, message dispatch.
- Server imports `applyAction` from `shared/`.
- Add `Bun.serve` entry point. Test locally with `bun run src/server/server.ts`.
- No client changes yet — server runs but isn't used.

### Stage C — Client networking
- Add `src/client/network/`. Implement `ReconnectingSocket`, `MessageRouter`, `ActionDispatcher`.
- Add Home and Lobby screens (minimal UI: nickname input, create/join room, room code display).
- Replace local `applyAction` with `network.send({ type: 'action', action })`. Receive events, apply them.
- URL routing for room+pid. `rejoin` flow on startup if URL has both.

### Stage D — Resilience
- Heartbeat (server WS ping + client app-level ping).
- `visibilitychange`, `resume`, `online`/`offline` handlers.
- Disconnect grace period on server.
- Reconnecting UI banner; input blocking when disconnected.
- State snapshot reply on rejoin.

### Stage E — Deployment
- Dockerfile for the server (Bun-based image). Existing Cloud Run service is split: client served via current nginx static, server runs as a separate Cloud Run service with WebSocket enabled.
- Or unified: a single Cloud Run service running Bun, serving the static `dist/` AND the WebSocket on the same port. Simpler for a pet project.
- Client picks server URL from build-time env var.

### Out of scope after Stage E (future work)
- AI bots for solo play.
- Replays from event log.
- Server-side state persistence (Redis or SQLite) so matches survive a server restart.
- Stricter authorization (signed tokens, replay protection).
- 4-player free-for-all variant.

## 12. Testing Strategy

- Unit tests for `applyAction`: feed in `(state, action)` pairs, assert `(newState, events)`. Tests are fast because the reducer is pure.
- Integration tests for the server: spin up a `Bun.serve`, connect two test WebSocket clients, replay scripted action sequences, assert on the events each client receives.
- Manual: open two browser windows side by side; play a full match.

Property-based / fuzz testing is overkill for v1 but a future option.

## 13. Open Questions

These are intentionally left for the implementation phase:

- **Move animations during opponent's turn**: should the opponent's `MOVE_UNIT` event trigger the same walk animation as your own move, or just teleport for speed? Probably yes-animate, but pace events to not stack up.
- **Turn timer**: should there be a per-turn time limit? Cleaner UX with one, but easy to add later — skip for v1.
- **Player A vs Player B assignment**: by join order, or random? Probably random for fairness, but consistent for testing — pick at room start by `Math.random() < 0.5`.
- **Reconnect during opponent's animation**: if you reconnect mid-animation, the server-sent snapshot represents post-animation state. The client just renders the result, no problem.
