/**
 * RoomManager — registry of active rooms and their lifecycle.
 *
 * Responsibilities:
 *   - create / join / rejoin / leave rooms
 *   - allocate a 'pid' for a new player
 *   - clean up disconnected players past the grace period
 *   - close empty rooms
 */

import type { ServerWebSocket } from 'bun';
import type { PlayerId } from '../types.ts';
import { Room, type RoomPlayer, type WsData } from './room.ts';

const ROOM_ID_LENGTH = 8;
const PID_LENGTH = 16;
const DISCONNECT_GRACE_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 (look-alikes)

function randomId(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export interface CreateRoomResult {
  room: Room;
  player: RoomPlayer;
}

export interface JoinRoomResult {
  ok: true;
  room: Room;
  player: RoomPlayer;
}

export interface JoinRoomError {
  ok: false;
  error: string;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Iterate every active room — used by the heartbeat scan. */
  allRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  createRoom(nickname: string, ws: ServerWebSocket<WsData>): CreateRoomResult {
    let id = randomId(ROOM_ID_LENGTH);
    while (this.rooms.has(id)) id = randomId(ROOM_ID_LENGTH);

    const room = new Room(id);
    const player: RoomPlayer = {
      pid: randomId(PID_LENGTH),
      nickname: nickname.slice(0, 32) || 'Anon',
      playerId: 'A', // first joiner is A
      ws,
      disconnectedAt: null,
    };
    room.players.set(player.pid, player);
    this.rooms.set(id, room);

    ws.data.roomId = id;
    ws.data.pid = player.pid;

    return { room, player };
  }

  joinRoom(roomId: string, nickname: string, ws: ServerWebSocket<WsData>): JoinRoomResult | JoinRoomError {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.status === 'ended') return { ok: false, error: 'room_ended' };

    const playerId = room.availablePlayerId();
    if (!playerId) return { ok: false, error: 'room_full' };

    const player: RoomPlayer = {
      pid: randomId(PID_LENGTH),
      nickname: nickname.slice(0, 32) || 'Anon',
      playerId,
      ws,
      disconnectedAt: null,
    };
    room.players.set(player.pid, player);

    ws.data.roomId = roomId;
    ws.data.pid = player.pid;

    return { ok: true, room, player };
  }

  rejoinRoom(roomId: string, pid: string, ws: ServerWebSocket<WsData>): JoinRoomResult | JoinRoomError {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };

    const player = room.players.get(pid);
    if (!player) return { ok: false, error: 'player_not_in_room' };

    // Drop the old socket if still considered open (defensive).
    if (player.ws && player.ws.readyState === WebSocket.OPEN && player.ws !== ws) {
      try {
        player.ws.close(4000, 'replaced_by_rejoin');
      } catch {
        /* ignore */
      }
    }

    player.ws = ws;
    player.disconnectedAt = null;
    ws.data.roomId = roomId;
    ws.data.pid = pid;

    return { ok: true, room, player };
  }

  leaveRoom(roomId: string, pid: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.get(pid);
    if (!player) return null;
    room.players.delete(pid);
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
    }
    return room;
  }

  /** Mark the player as disconnected; do not delete (grace period). */
  markDisconnected(roomId: string, pid: string): RoomPlayer | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.get(pid);
    if (!player) return null;
    player.ws = null;
    player.disconnectedAt = Date.now();
    return player;
  }

  // -------------------------------------------------------------------------
  // Cleanup loop
  // -------------------------------------------------------------------------

  private cleanup(): void {
    const cutoff = Date.now() - DISCONNECT_GRACE_MS;
    for (const [roomId, room] of this.rooms) {
      for (const [pid, player] of room.players) {
        if (player.ws === null && player.disconnectedAt !== null && player.disconnectedAt < cutoff) {
          room.players.delete(pid);
          console.log(`[room ${roomId}] removed stale player ${pid} (${player.nickname})`);
        }
      }
      if (room.players.size === 0) {
        this.rooms.delete(roomId);
        console.log(`[room ${roomId}] closed (empty)`);
      }
    }
  }

  // For tests / health.
  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.players.size;
    return { rooms: this.rooms.size, players };
  }
}
