/**
 * Display-name registry for player slots A/B.
 *
 * The game-state Player object has no nickname field — names live on the
 * server (RoomPlayer.nickname) and arrive via lobby events. This module
 * holds the map that the UI uses to render labels.
 *
 * In single-player the registry stays at the defaults ("Player A" / "Player B").
 * In multiplayer the network module populates it on every room_joined /
 * room_created / rejoined / player_joined message.
 */

import type { PlayerId } from './types.ts';
import type { PlayerInfo } from './shared/protocol.ts';

const names: Record<PlayerId, string> = {
  A: 'Player A',
  B: 'Player B',
};

let myPlayerId: PlayerId | null = null;

export function setPlayerName(playerId: PlayerId, name: string): void {
  names[playerId] = name;
}

export function getPlayerName(playerId: PlayerId): string {
  return names[playerId];
}

export function getMyPlayerId(): PlayerId | null {
  return myPlayerId;
}

export function setMyPlayerId(playerId: PlayerId | null): void {
  myPlayerId = playerId;
}

/** True if this browser is the player whose turn it currently is. */
export function isMyTurn(currentPlayerId: PlayerId): boolean {
  // In single-player (no myPlayerId set) every turn is "yours" (hot-seat).
  if (myPlayerId === null) return true;
  return myPlayerId === currentPlayerId;
}

/** Bulk update — called on every lobby update with the full roster. */
export function applyPlayerRoster(players: PlayerInfo[]): void {
  for (const p of players) {
    if (p.nickname) names[p.playerId] = p.nickname;
  }
}
