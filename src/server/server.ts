/**
 * BoardGame multiplayer server.
 *
 * Run with `bun run src/server/server.ts`.
 *
 * Two roles in one process:
 *   1. WebSocket gameplay (/ws) — room lifecycle + reducer action handling
 *      + state broadcast.
 *   2. Static file server — when DIST_DIR exists (Cloud Run / preview),
 *      serve the built Vite bundle on every non-/ws, non-/healthz path so
 *      the same hostname hosts both client and server. In dev we don't
 *      build the bundle, Vite serves it on its own port.
 */

import { join, normalize } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { RoomManager } from './roomManager.ts';
import type { WsData } from './room.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';
import { applyAction } from '../shared/reducer.ts';
import { flushEvents } from '../shared/events.ts';
import { setActiveContext } from '../state.ts';
import { startGame as engineStartGame } from '../engine/turnManager.ts';
import { registerServerEngineDeps } from './serverBootstrap.ts';

// Wire up the engine's late-bound dependencies with their pure server-side
// implementations. Without this every startTurn would set player.energy = 0.
registerServerEngineDeps();

const PORT = Number(process.env.PORT ?? 3001);
const HEARTBEAT_INTERVAL_MS = 25_000;

// In production we ship `dist/` next to the server bundle (built by
// `vite build` in the Dockerfile) and serve it on the same port as /ws.
// In dev DIST_DIR doesn't exist and Vite serves the bundle on 5173.
const DIST_DIR = process.env.DIST_DIR ?? 'dist';
const HAS_DIST = existsSync(DIST_DIR);
if (HAS_DIST) {
  console.log(`[server] static files: ${DIST_DIR}`);
} else {
  console.log(`[server] no dist/ — running in API-only mode (use Vite for the client)`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname: string): Response | null {
  if (!HAS_DIST) return null;

  // Resolve URL → file path inside dist/. Trailing slash → index.html.
  // Path traversal protection: normalize and ensure result stays under DIST_DIR.
  let rel = pathname.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`;
  const candidate = normalize(join(DIST_DIR, rel));
  if (!candidate.startsWith(normalize(DIST_DIR))) return new Response('Forbidden', { status: 403 });

  let target = candidate;
  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, 'index.html');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    // SPA fallback for the main game: any unknown path under / serves /index.html
    // so client-side routing works. Sandbox is a flat single-page so we don't
    // do SPA fallback under /sandbox — a 404 is more useful there.
    if (pathname.startsWith('/sandbox')) return new Response('Not Found', { status: 404 });
    target = join(DIST_DIR, 'index.html');
    if (!existsSync(target)) return new Response('Not Found', { status: 404 });
  }

  const ext = target.slice(target.lastIndexOf('.')).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  // Hashed assets get aggressive caching; HTML/JSON stay fresh.
  const isAsset = /\.(js|mjs|css|woff2?|png|jpg|jpeg|webp|svg|glb|gltf)$/i.test(target)
    && /-[A-Za-z0-9_-]{8,}\./i.test(target);
  const cacheControl = isAsset
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  return new Response(Bun.file(target), {
    headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
  });
}

const roomManager = new RoomManager();
roomManager.start();

function send(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function sendError(ws: { send: (data: string) => void }, message: string): void {
  send(ws, { type: 'error', message });
}

const server = Bun.serve<WsData, never>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // Liveness probe for Cloud Run / load balancers
    if (url.pathname === '/healthz') {
      const stats = roomManager.stats();
      return new Response(JSON.stringify({ ok: true, ...stats }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Upgrade WebSocket connections at /ws
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: {
          pid: null,
          roomId: null,
          isAlive: true,
        } satisfies WsData,
      });
      if (!upgraded) {
        return new Response('Upgrade failed', { status: 500 });
      }
      return undefined;
    }

    // Anything else: try the static file server (Vite-built dist/ in prod).
    const staticResponse = serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      ws.data.isAlive = true;
      console.log('[ws] connection opened');
    },

    message(ws, raw) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        sendError(ws, 'invalid_json');
        return;
      }

      // Mark this socket as alive on every inbound message — cheap liveness.
      ws.data.isAlive = true;

      switch (msg.type) {
        case 'ping':
          send(ws, { type: 'pong' });
          return;

        case 'create_room': {
          const { room, player } = roomManager.createRoom(msg.nickname, ws);
          send(ws, {
            type: 'room_created',
            roomId: room.id,
            pid: player.pid,
            playerId: player.playerId,
          });
          console.log(`[room ${room.id}] created by ${player.nickname} (${player.playerId})`);
          return;
        }

        case 'join_room': {
          const result = roomManager.joinRoom(msg.roomId, msg.nickname, ws);
          if (!result.ok) {
            sendError(ws, result.error);
            return;
          }
          const { room, player } = result;
          send(ws, {
            type: 'room_joined',
            roomId: room.id,
            pid: player.pid,
            playerId: player.playerId,
            players: room.publicPlayers(),
          });
          room.broadcastExcept(player.pid, {
            type: 'player_joined',
            player: {
              pid: player.pid,
              nickname: player.nickname,
              playerId: player.playerId,
              connected: true,
            },
          });
          console.log(`[room ${room.id}] ${player.nickname} (${player.playerId}) joined`);

          // Auto-start the game once both players are in the room.
          if (room.status === 'waiting' && room.players.size === 2) {
            setActiveContext(room.context);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stateRef = room.context.state as any;
            console.log(`[room ${room.id}] BEFORE startGame: A.energy=${stateRef.players.A.energy} B.energy=${stateRef.players.B.energy} current=${stateRef.currentPlayerId}`);
            engineStartGame();
            console.log(`[room ${room.id}] AFTER startGame: A.energy=${stateRef.players.A.energy} B.energy=${stateRef.players.B.energy} current=${stateRef.currentPlayerId}`);
            const events = flushEvents();
            room.status = 'playing';
            if (events.length > 0) {
              room.broadcast({ type: 'events', events });
            }
            room.broadcast({ type: 'state_snapshot', state: room.context.state });
            console.log(`[room ${room.id}] game started`);
          }
          return;
        }

        case 'rejoin': {
          const result = roomManager.rejoinRoom(msg.roomId, msg.pid, ws);
          if (!result.ok) {
            sendError(ws, result.error);
            return;
          }
          const { room, player } = result;
          send(ws, {
            type: 'rejoined',
            roomId: room.id,
            playerId: player.playerId,
            players: room.publicPlayers(),
          });
          room.broadcastExcept(player.pid, { type: 'player_reconnected', pid: player.pid });
          // Push the current state to the rejoining client so the UI can recover.
          if (room.status !== 'waiting') {
            send(ws, { type: 'state_snapshot', state: room.context.state });
          }
          console.log(`[room ${room.id}] ${player.nickname} (${player.playerId}) rejoined`);
          return;
        }

        case 'leave_room': {
          const { pid, roomId } = ws.data;
          if (!pid || !roomId) return;
          const room = roomManager.leaveRoom(roomId, pid);
          if (room) room.broadcast({ type: 'player_left', pid });
          ws.data.pid = null;
          ws.data.roomId = null;
          return;
        }

        case 'action': {
          const { pid, roomId } = ws.data;
          if (!pid || !roomId) {
            send(ws, { type: 'action_rejected', reason: 'not_in_room' });
            return;
          }
          const room = roomManager.get(roomId);
          if (!room) {
            send(ws, { type: 'action_rejected', reason: 'room_not_found' });
            return;
          }
          const player = room.players.get(pid);
          if (!player) {
            send(ws, { type: 'action_rejected', reason: 'player_not_in_room' });
            return;
          }

          // Swap the room's state into the engine's active slot, run the
          // reducer, drain any events emitted into the shared buffer, broadcast.
          setActiveContext(room.context);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const before = room.context.state as any;
          console.log(`[room ${roomId}] BEFORE action ${msg.action.type}: A.energy=${before.players.A.energy} B.energy=${before.players.B.energy} current=${before.currentPlayerId}`);
          const result = applyAction(msg.action);
          const events = flushEvents();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const after = room.context.state as any;
          console.log(`[room ${roomId}] AFTER action ${msg.action.type}: A.energy=${after.players.A.energy} B.energy=${after.players.B.energy} current=${after.currentPlayerId}`);

          if (!result.ok) {
            send(ws, { type: 'action_rejected', reason: result.error });
            console.log(`[room ${roomId}] action ${msg.action.type} from ${pid} REJECTED: ${result.error}`);
            return;
          }

          // Stage C MVP: broadcast events for animations/log + a full state
          // snapshot for sync. Event refinement (semantic per-event state
          // mutations) is a Stage C+ improvement.
          if (events.length > 0) {
            room.broadcast({ type: 'events', events });
          }
          room.broadcast({ type: 'state_snapshot', state: room.context.state });
          console.log(`[room ${roomId}] action ${msg.action.type} from ${pid} OK (${events.length} events)`);
          return;
        }

        default: {
          // Exhaustiveness — TypeScript will error if a case is missing.
          const _exhaustive: never = msg;
          void _exhaustive;
          sendError(ws, 'unknown_message_type');
          return;
        }
      }
    },

    close(ws, code, reason) {
      const { pid, roomId } = ws.data;
      const tag = `code=${code} reason=${JSON.stringify(reason ?? '')}`;
      if (pid && roomId) {
        const player = roomManager.markDisconnected(roomId, pid);
        if (player) {
          const room = roomManager.get(roomId);
          if (room) room.broadcast({ type: 'player_disconnected', pid });
          console.log(`[room ${roomId}] ${player.nickname} disconnected (grace period) ${tag}`);
        }
      } else {
        console.log(`[ws] connection closed (no room) ${tag}`);
      }
    },

    pong(ws) {
      ws.data.isAlive = true;
    },
  },
});

// Heartbeat strategy
// ------------------------------------------------------------------
// Browser WebSocket API can't send ping frames, so the *client* drives
// heartbeat: it sends `{ type: 'ping' }` every 30s and we respond with
// `{ type: 'pong' }`. Any inbound message refreshes `ws.data.isAlive`.
//
// Without an active scan, a browser that died without a close frame
// (OS crash, kill -9) keeps its socket "open" on the server until TCP
// keepalive trips — that's hours locally and capped at Cloud Run's
// --timeout (1h here). Combined with the 5-min disconnect grace this
// could leave a zombie room visible for ~65 minutes.
//
// The scan below closes any socket that hasn't sent us anything in
// HEARTBEAT_INTERVAL_MS — at which point the regular `close` handler
// runs, the player goes into grace, and 5 minutes later the room
// evaporates. Normal close-frames still fire instantly; this only
// catches dead clients.
function heartbeatScan(): void {
  for (const room of roomManager.allRooms()) {
    for (const player of room.players.values()) {
      const ws = player.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (ws.data.isAlive === false) {
        try { ws.close(4001, 'heartbeat_timeout'); } catch { /* ignore */ }
        continue;
      }
      ws.data.isAlive = false;
    }
  }
}
setInterval(heartbeatScan, HEARTBEAT_INTERVAL_MS);

console.log(`[server] listening on http://localhost:${PORT} (ws path: /ws)`);
console.log(`[server] healthz: http://localhost:${PORT}/healthz`);
