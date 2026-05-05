/**
 * Shared test fixture for engine unit tests.
 *
 * The engine reads from a global `state` proxy that delegates to the active
 * context. Tests need to:
 *   1. Build a fresh ActiveStateContext before each test (no cross-test leakage).
 *   2. Register the late-bound deps (refreshPlayerMaxEnergy, etc.) with pure
 *      implementations — the default `() => 0` zeros out player energy on
 *      startTurn and breaks every test that touches the turn cycle.
 *   3. Drain the event buffer and expose it for assertions.
 */

import { setActiveContext, createInitialGameState } from '../src/state.ts';
import { setEventSink, flushEvents, type GameEvent } from '../src/shared/events.ts';
import { registerCombatDeps } from '../src/engine/combat.ts';
import { registerTurnManagerDeps, drawCards, applyProcessEchoPlayResult } from '../src/engine/turnManager.ts';
import { registerAbilityDeps } from '../src/engine/abilities.ts';
import { registerBuildingDeps } from '../src/engine/buildings.ts';
import { removeUnitShield, applyShieldToUnit, addShimmeringCloak } from '../src/engine/unitStats.ts';
import { setEnergy, setMaxEnergy } from '../src/engine/playerResources.ts';
import { MAX_ENERGY } from '../src/constants.ts';
import type { GameState, PlayerId, Player } from '../src/types';

let collectedEvents: GameEvent[] = [];

function refreshPlayerMaxEnergy(this: void, playerId: PlayerId, clampEnergy: boolean = true): number {
  // Mirror the server-side implementation. A test that mutates building lists
  // and wants the cap to follow can call this directly; otherwise the default
  // MAX_ENERGY is enough for combat / move tests.
  const ctx = (globalThis as unknown as { __testState?: GameState }).__testState;
  if (!ctx) return MAX_ENERGY;
  const player = ctx.players[playerId];
  if (!player) return MAX_ENERGY;
  const datacenterCount = (player.buildings ?? []).filter((b) => b.type === 'DATACENTER').length;
  const computedMaxEnergy = MAX_ENERGY + datacenterCount * 5;
  setMaxEnergy(player, computedMaxEnergy);
  if (clampEnergy) {
    setEnergy(player, Math.min(player.energy, computedMaxEnergy));
  }
  return computedMaxEnergy;
}

function getPlayerMaxEnergy(player: Player | null | undefined): number {
  return player?.maxEnergy ?? MAX_ENERGY;
}

let depsRegistered = false;
function registerOnce(): void {
  if (depsRegistered) return;
  depsRegistered = true;
  registerCombatDeps({ removeUnitShield, refreshPlayerMaxEnergy });
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
  registerBuildingDeps({ drawCards, refreshPlayerMaxEnergy, getPlayerMaxEnergy });

  // Sink: just collect events, no DOM/Three.js side-effects in tests.
  setEventSink((events) => {
    collectedEvents.push(...events);
  });
}

/** Call once at the top of each test (or in beforeEach) to get a clean game. */
export function freshGame(): GameState {
  registerOnce();
  const ctx = { state: createInitialGameState(), unitIdCounter: 1 };
  setActiveContext(ctx);
  // Stash a reference for the late-bound deps to find.
  (globalThis as unknown as { __testState: GameState }).__testState = ctx.state;
  collectedEvents = [];
  flushEvents();
  return ctx.state;
}

/** Drain whatever the engine emitted since the last call. */
export function takeEvents(): GameEvent[] {
  // Engine emits synchronously into the buffer; the sink runs on a microtask.
  // Force-drain so tests don't have to await the microtask.
  const drained = flushEvents();
  collectedEvents.push(...drained);
  const out = collectedEvents;
  collectedEvents = [];
  return out;
}

/** Find first event of a given type (handy for assertions). */
export function firstEvent<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }> | undefined {
  const events = takeEvents();
  collectedEvents.unshift(...events); // restore for further calls
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
