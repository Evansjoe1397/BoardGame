/**
 * WebSocket message protocol — what flows over the wire between the client
 * and the server.
 *
 * Two layers:
 *   1. Game actions (the player's intent) — defined in shared/actions.ts
 *      These are wrapped in a ClientMessage of type 'action'.
 *   2. Connection-level messages (room join/leave, rejoin, ping, errors) —
 *      defined here. These are not game actions; they manage the session.
 *
 * Wire format: every message is JSON. Each direction has its own union.
 */

import type { Action } from './actions.ts';
import type { GameEvent } from './events.ts';
import type { PlayerId } from '../types.ts';

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  // Lobby
  | { type: 'create_room'; nickname: string }
  | { type: 'join_room'; roomId: string; nickname: string }
  | { type: 'rejoin'; roomId: string; pid: string }
  | { type: 'leave_room' }

  // Gameplay — wraps a typed Action (server-validated)
  | { type: 'action'; action: Action }

  // Heartbeat
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface PlayerInfo {
  pid: string;
  nickname: string;
  playerId: PlayerId;
  connected: boolean;
}

export type ServerMessage =
  // Acks for room operations
  | { type: 'room_created'; roomId: string; pid: string; playerId: PlayerId }
  | { type: 'room_joined'; roomId: string; pid: string; playerId: PlayerId; players: PlayerInfo[] }
  | { type: 'rejoined'; roomId: string; playerId: PlayerId; players: PlayerInfo[] }

  // Notifications about the room (sent to all participants)
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_disconnected'; pid: string }
  | { type: 'player_reconnected'; pid: string }
  | { type: 'player_left'; pid: string }
  | { type: 'room_closed' }

  // Game events broadcast — what the server emits after applying an action.
  // Events can be filtered per recipient (hidden cards become null).
  | { type: 'events'; events: GameEvent[] }

  // The server can push a full state snapshot on rejoin or as a recovery
  // mechanism. For Stage B this is unimplemented; Stage C will define the
  // projected GameState shape.
  | { type: 'state_snapshot'; state: unknown }

  // Action rejected — sent back to the originating client only.
  | { type: 'action_rejected'; reason: string }

  // Heartbeat
  | { type: 'pong' }

  // Generic error
  | { type: 'error'; message: string };
