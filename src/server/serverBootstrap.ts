/**
 * Server-side dependency registration.
 *
 * The engine modules (combat / turnManager / abilities / buildings) declare
 * a few late-bound dependencies that are wired up at startup. On the client
 * those wires include real Three.js callbacks; on the server we only need
 * the *pure* game-logic implementations and stub out the visual effects.
 *
 * Without this bootstrap the engine's `refreshPlayerMaxEnergy` falls back
 * to its default `() => 0` and any startTurn call drops player energy to 0.
 */

import type { PlayerId } from '../types.ts';
import { state } from '../state.ts';
import { MAX_ENERGY } from '../constants.ts';

import { registerCombatDeps } from '../engine/combat.ts';
import { registerTurnManagerDeps, drawCards, applyProcessEchoPlayResult } from '../engine/turnManager.ts';
import { registerAbilityDeps } from '../engine/abilities.ts';
import { registerBuildingDeps } from '../engine/buildings.ts';
import { removeUnitShield, applyShieldToUnit, addShimmeringCloak } from '../engine/unitStats.ts';

// Pure (no DOM, no Three.js) port of the function defined in src/ui/renderUI.ts.
// The two implementations must stay in sync — Stage C+ will move both to
// shared engine code so the duplication goes away.
function refreshPlayerMaxEnergy(playerId: PlayerId, clampEnergy: boolean = true): number {
  const player = state.players[playerId];
  if (!player) return MAX_ENERGY;
  const datacenterCount = (player.buildings ?? []).filter((b) => b.type === 'DATACENTER').length;
  const computedMaxEnergy = MAX_ENERGY + datacenterCount * 5;
  player.maxEnergy = computedMaxEnergy;
  if (clampEnergy) {
    player.energy = Math.min(player.energy, computedMaxEnergy);
  }
  return computedMaxEnergy;
}

function getPlayerMaxEnergy(player: { maxEnergy?: number } | null | undefined): number {
  return player?.maxEnergy ?? MAX_ENERGY;
}

// Three.js position dummy — engine doesn't really need real coordinates here,
// only client-side animations do. The server emits the same EFFECT events that
// the client emits; the client side of those wires already converts to Vector3
// in eventApplier.ts.
function dummyWorldPosition(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

export function registerServerEngineDeps(): void {
  registerCombatDeps({
    removeUnitShield,
    refreshPlayerMaxEnergy,
    // Cast through unknown — the engine signature wants a THREE.Vector3 but on
    // the server it never reads any field except .x/.y/.z. The struct above is
    // structurally compatible.
    getUnitWorldPosition: () => dummyWorldPosition() as unknown as import('three').Vector3,
    playRifleShot: () => {},
    playHitEffect: () => {},
    playExplosionAt: () => {},
  });

  registerTurnManagerDeps({
    refreshPlayerMaxEnergy,
    playSupplyHarvestCoins: () => {},
    flashSupplyHarvested: () => {},
  });

  registerAbilityDeps({
    playRepairCasterAnimation: () => {},
    playRepairTargetAnimation: () => {},
    applyShieldToUnit,
    addShimmeringCloak,
    applyProcessEchoPlayResult,
  });

  registerBuildingDeps({
    drawCards,
    refreshPlayerMaxEnergy,
    getPlayerMaxEnergy,
  });
}
