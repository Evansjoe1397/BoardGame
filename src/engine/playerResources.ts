/**
 * Helpers that bundle a player-resource mutation with the matching event.
 *
 * Use these instead of writing `player.energy -= cost` directly so the
 * receiving client picks up the change without a full state_snapshot.
 */

import type { Player } from '../types.ts';
import { emit } from '../shared/events.ts';

// Each helper mutates the field and emits the corresponding event.
// Callers must only invoke them at points where the value is actually
// expected to change — there is intentionally no "no-op guard"; if you
// hit a redundant call, that is a bug at the call site, not here.

export function setEnergy(player: Player, newEnergy: number): void {
  player.energy = newEnergy;
  emit({ type: 'ENERGY_CHANGED', player: player.id, newEnergy });
}

export function setSupply(player: Player, newSupply: number): void {
  player.supply = newSupply;
  emit({ type: 'SUPPLY_CHANGED', player: player.id, newSupply });
}

export function setMaxEnergy(player: Player, newMaxEnergy: number): void {
  player.maxEnergy = newMaxEnergy;
  emit({ type: 'MAX_ENERGY_CHANGED', player: player.id, newMaxEnergy });
}
