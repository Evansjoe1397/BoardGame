/**
 * BoardGame multiplayer server.
 *
 * Run with `bun run src/server/server.ts`.
 *
 * Stage B scope: connection lifecycle, room management, heartbeat. The
 * 'action' message type is acknowledged but does not yet drive game logic
 * — that wiring lands in Stage C together with client integration.
 */

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

    // Upgrade WebSocket connections at /ws (anything else returns 404)
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

    close(ws) {
      const { pid, roomId } = ws.data;
      if (pid && roomId) {
        const player = roomManager.markDisconnected(roomId, pid);
        if (player) {
          const room = roomManager.get(roomId);
          if (room) room.broadcast({ type: 'player_disconnected', pid });
          console.log(`[room ${roomId}] ${player.nickname} disconnected (grace period)`);
        }
      } else {
        console.log('[ws] connection closed (no room)');
      }
    },

    pong(ws) {
      ws.data.isAlive = true;
    },
  },
});

// Heartbeat strategy
// ------------------------------------------------------------------
// We rely on the *client* to send `{ type: 'ping' }` periodically (the
// browser WebSocket API doesn't expose ping frames, so this is the only
// portable approach). The server replies with `{ type: 'pong' }` and
// uses any inbound message to refresh `ws.data.isAlive`. This keeps the
// socket warm under Cloud Run's idle timeout.
//
// We don't actively scan for stale sockets here — Bun's underlying TCP
// keepalive plus the disconnect grace period in RoomManager.cleanup()
// is sufficient for a pet project.
void HEARTBEAT_INTERVAL_MS;

console.log(`[server] listening on http://localhost:${PORT} (ws path: /ws)`);
console.log(`[server] healthz: http://localhost:${PORT}/healthz`);
