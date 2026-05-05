/**
 * High-level network module.
 *
 * Owns:
 *   - the singleton ReconnectingSocket
 *   - server URL resolution (build-time env or window.location.host)
 *   - server message routing into the local app (events, snapshots, errors)
 *   - identity tracking (room, pid, playerId)
 *   - URL synchronisation (?room=…&pid=…)
 *   - Page Visibility / Page Lifecycle / online-offline reconnect triggers
 */

import type { Action } from '../shared/actions.ts';
import type { GameEvent } from '../shared/events.ts';
import type { ClientMessage, ServerMessage, PlayerInfo } from '../shared/protocol.ts';
import type { GameState, PlayerId } from '../types.ts';
import { ReconnectingSocket } from './ReconnectingSocket.ts';
import { applyPlayerRoster, setMyPlayerId, setPlayerName } from '../playerNames.ts';

// ---------------------------------------------------------------------------
// Server URL
// ---------------------------------------------------------------------------

function resolveServerUrl(): string {
  const env = (import.meta as { env?: { VITE_SERVER_URL?: string; DEV?: boolean } }).env ?? {};
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';

  // Dev (Vite on 5173) → talk to the standalone Bun server on :3001.
  // Prod (Cloud Run) → Bun serves both static and /ws on the same origin,
  // so we use location.host (includes port if any) and skip the explicit :3001.
  if (env.DEV) {
    const host = location.hostname || 'localhost';
    return `${proto}//${host}:3001/ws`;
  }
  return `${proto}//${location.host}/ws`;
}

const SERVER_URL = resolveServerUrl();

// ---------------------------------------------------------------------------
// Identity & state
// ---------------------------------------------------------------------------

export interface Identity {
  roomId: string;
  pid: string;
  playerId: PlayerId;
}

let identity: Identity | null = null;
let players: PlayerInfo[] = [];
let connected = false;

// ---------------------------------------------------------------------------
// Listeners (host app subscribes to these)
// ---------------------------------------------------------------------------

type Listener<T> = (value: T) => void;
const eventsListeners: Listener<GameEvent[]>[] = [];
const snapshotListeners: Listener<GameState>[] = [];
const lobbyListeners: Listener<{ players: PlayerInfo[] }>[] = [];
const connectionListeners: Listener<boolean>[] = [];
const errorListeners: Listener<string>[] = [];

export function onEvents(fn: Listener<GameEvent[]>): () => void {
  eventsListeners.push(fn);
  return () => { const i = eventsListeners.indexOf(fn); if (i >= 0) eventsListeners.splice(i, 1); };
}

export function onSnapshot(fn: Listener<GameState>): () => void {
  snapshotListeners.push(fn);
  return () => { const i = snapshotListeners.indexOf(fn); if (i >= 0) snapshotListeners.splice(i, 1); };
}

export function onLobby(fn: Listener<{ players: PlayerInfo[] }>): () => void {
  lobbyListeners.push(fn);
  return () => { const i = lobbyListeners.indexOf(fn); if (i >= 0) lobbyListeners.splice(i, 1); };
}

export function onConnectionChange(fn: Listener<boolean>): () => void {
  connectionListeners.push(fn);
  return () => { const i = connectionListeners.indexOf(fn); if (i >= 0) connectionListeners.splice(i, 1); };
}

export function onError(fn: Listener<string>): () => void {
  errorListeners.push(fn);
  return () => { const i = errorListeners.indexOf(fn); if (i >= 0) errorListeners.splice(i, 1); };
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

const socket = new ReconnectingSocket(SERVER_URL);

socket.on('connected', () => {
  connected = true;
  for (const fn of connectionListeners) fn(true);
  // If we already have an identity, attempt to rejoin on every reconnect.
  if (identity) {
    socket.send({ type: 'rejoin', roomId: identity.roomId, pid: identity.pid } satisfies ClientMessage);
  }
});

socket.on('disconnected', () => {
  connected = false;
  for (const fn of connectionListeners) fn(false);
});

socket.on('message', (raw) => {
  const msg = raw as ServerMessage;
  switch (msg.type) {
    case 'room_created':
      identity = { roomId: msg.roomId, pid: msg.pid, playerId: msg.playerId };
      // The server doesn't echo back our own nickname here — populate the
      // creator slot from the local input we just submitted (cached below).
      players = [{ pid: msg.pid, nickname: lastSentNickname, playerId: msg.playerId, connected: true }];
      setMyPlayerId(msg.playerId);
      applyPlayerRoster(players);
      writeUrl(identity);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'room_joined':
      identity = { roomId: msg.roomId, pid: msg.pid, playerId: msg.playerId };
      players = msg.players;
      setMyPlayerId(msg.playerId);
      applyPlayerRoster(players);
      writeUrl(identity);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'rejoined':
      identity = { ...(identity ?? { roomId: '', pid: '' }), playerId: msg.playerId } as Identity;
      players = msg.players;
      setMyPlayerId(msg.playerId);
      applyPlayerRoster(players);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'player_joined':
      players = [...players, msg.player];
      applyPlayerRoster(players);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'player_disconnected':
      players = players.map((p) => p.pid === msg.pid ? { ...p, connected: false } : p);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'player_reconnected':
      players = players.map((p) => p.pid === msg.pid ? { ...p, connected: true } : p);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'player_left':
      players = players.filter((p) => p.pid !== msg.pid);
      for (const fn of lobbyListeners) fn({ players });
      break;

    case 'room_closed':
      identity = null;
      players = [];
      setMyPlayerId(null);
      clearUrl();
      for (const fn of errorListeners) fn('room_closed');
      break;

    case 'events':
      for (const fn of eventsListeners) fn(msg.events);
      break;

    case 'state_snapshot':
      for (const fn of snapshotListeners) fn(msg.state as GameState);
      break;

    case 'action_rejected':
      console.warn('[server rejected action]', msg.reason);
      for (const fn of errorListeners) fn(`action rejected: ${msg.reason}`);
      break;

    case 'error':
      for (const fn of errorListeners) fn(msg.message);
      break;

    case 'pong':
      // handled inside ReconnectingSocket
      break;
  }
});

// ---------------------------------------------------------------------------
// Page Visibility / Lifecycle / online-offline integration
// ---------------------------------------------------------------------------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!socket.isConnected()) socket.forceReconnect();
  }
});

// Page Lifecycle resume (Chrome-specific; harmless elsewhere)
document.addEventListener('resume', () => {
  socket.forceReconnect();
});

window.addEventListener('online', () => socket.forceReconnect());

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function writeUrl(id: Identity): void {
  const url = new URL(location.href);
  url.searchParams.set('room', id.roomId);
  url.searchParams.set('pid', id.pid);
  history.replaceState(null, '', url.toString());
}

function clearUrl(): void {
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('pid');
  history.pushState(null, '', url.toString());
}

export function readUrlIdentity(): { roomId: string; pid: string } | null {
  const url = new URL(location.href);
  const roomId = url.searchParams.get('room');
  const pid = url.searchParams.get('pid');
  return roomId && pid ? { roomId, pid } : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function start(): void { socket.connect(); }

export function isConnected(): boolean { return connected; }

export function getIdentity(): Identity | null { return identity; }

export function getPlayers(): PlayerInfo[] { return players; }

// Cached last-sent nickname so room_created (which doesn't echo it) can
// populate the local roster.
let lastSentNickname = '';

export function createRoom(nickname: string): boolean {
  lastSentNickname = nickname;
  return socket.send({ type: 'create_room', nickname } satisfies ClientMessage);
}

export function joinRoom(roomId: string, nickname: string): boolean {
  lastSentNickname = nickname;
  return socket.send({ type: 'join_room', roomId, nickname } satisfies ClientMessage);
}

/** Used on startup when the URL has both ?room= and ?pid= params. */
export function tryRejoinFromUrl(): boolean {
  const fromUrl = readUrlIdentity();
  if (!fromUrl) return false;
  // Pre-populate identity so it's available even before the server confirms;
  // the auto-rejoin in the 'connected' listener will pick it up if the socket
  // is already open.
  identity = { roomId: fromUrl.roomId, pid: fromUrl.pid, playerId: 'A' };
  if (socket.isConnected()) {
    socket.send({ type: 'rejoin', roomId: fromUrl.roomId, pid: fromUrl.pid } satisfies ClientMessage);
  }
  return true;
}

export function leaveRoom(): void {
  socket.send({ type: 'leave_room' } satisfies ClientMessage);
  identity = null;
  players = [];
  clearUrl();
}

export function sendAction(action: Action): boolean {
  return socket.send({ type: 'action', action } satisfies ClientMessage);
}
