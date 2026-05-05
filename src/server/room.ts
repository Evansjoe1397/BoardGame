/**
 * Room — a single 2-player match in memory on the server.
 *
 * Stage B scope: data model + lifecycle (join/rejoin/disconnect/cleanup).
 * Stage C will plug the shared reducer so the room can apply Actions.
 */

import type { ServerWebSocket } from 'bun';
import type { GameState, PlayerId } from '../types.ts';
import type { PlayerInfo, ServerMessage } from '../shared/protocol.ts';
import { createInitialGameState } from '../state.ts';

export interface RoomStateContext {
  state: GameState;
  unitIdCounter: number;
}

export interface RoomPlayer {
  pid: string;
  nickname: string;
  playerId: PlayerId;
  ws: ServerWebSocket<WsData> | null;
  /** ms timestamp when the connection was lost; null while connected. */
  disconnectedAt: number | null;
}

/** Per-connection data attached to the WebSocket. */
export interface WsData {
  pid: string | null;
  roomId: string | null;
  /** Heartbeat freshness — set true on pong, server flips to false on ping. */
  isAlive: boolean;
}

export class Room {
  readonly id: string;
  readonly createdAt: number;
  readonly players: Map<string, RoomPlayer> = new Map();
  status: 'waiting' | 'playing' | 'ended' = 'waiting';

  // The room owns its own GameState + unit-ID counter. The server swaps this
  // context into the engine's active slot before running the reducer for an
  // action, so two concurrent rooms can never interfere.
  readonly context: RoomStateContext;

  constructor(id: string) {
    this.id = id;
    this.createdAt = Date.now();
    this.context = {
      state: createInitialGameState(),
      unitIdCounter: 1,
    };
  }

  /** Total slots used (connected + disconnected within grace window). */
  size(): number {
    return this.players.size;
  }

  /** Find an unused PlayerId ('A' or 'B'). null if room is full. */
  availablePlayerId(): PlayerId | null {
    const used = new Set<PlayerId>();
    for (const p of this.players.values()) used.add(p.playerId);
    if (!used.has('A')) return 'A';
    if (!used.has('B')) return 'B';
    return null;
  }

  /** Build the public list of players for room notifications. */
  publicPlayers(): PlayerInfo[] {
    return Array.from(this.players.values()).map((p) => ({
      pid: p.pid,
      nickname: p.nickname,
      playerId: p.playerId,
      connected: p.ws !== null,
    }));
  }

  /** Send a message to every connected player in the room. */
  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    }
  }

  /** Send to everyone except the originating pid. */
  broadcastExcept(excludePid: string, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.pid === excludePid) continue;
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(payload);
      }
    }
  }
}
