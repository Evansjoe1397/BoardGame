import type { GameState, Player, Card, ProcessEcho, PlayerId } from './types';
import { BASE_MAX_HIT_POINTS, MAX_ENERGY, STARTING_SUPPLY } from './constants';
import { CARD_LIBRARY } from './data/cardLibrary';

// ---------------------------------------------------------------------------
// Unit ID counter
// On the client this is a single global counter (one game per page).
// On the server we have N rooms; each room owns its own counter so unit IDs
// don't collide across matches. The active counter is swapped together with
// the active state via setActiveState().
// ---------------------------------------------------------------------------
interface ActiveStateContext {
  state: GameState;
  unitIdCounter: number;
}

let active: ActiveStateContext = {
  state: createInitialGameState(),
  unitIdCounter: 1,
};

export function nextUnitId(): string { return 'u' + active.unitIdCounter++; }

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createEmptyProcessEcho(): ProcessEcho {
  return {
    X: null,
    1: null,
    2: null,
    3: null
  };
}

export function createStarterDeck(): Card[] {
  const deck: Card[] = [
    { cardId: CARD_LIBRARY.PAWN_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.PAWN_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.SUPPORT_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.SUPPORT_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.TANK_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.TANK_DRONE.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.HARVEST_DATA.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.SHIELDING.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.SYSTEM_SHOCK.id, producedAt: 'Base' },
    { cardId: CARD_LIBRARY.SHIMMERING_CLOAK.id, producedAt: 'Base' },
  ];
  return shuffle(deck);
}

export function createPlayer(playerId: PlayerId): Player {
  return {
    id: playerId,
    baseHitPoints: BASE_MAX_HIT_POINTS,
    baseMaxHitPoints: BASE_MAX_HIT_POINTS,
    baseDestroyed: false,
    maxEnergy: MAX_ENERGY,
    energy: MAX_ENERGY,
    supply: STARTING_SUPPLY,
    deck: createStarterDeck(),
    hand: [],
    discard: [],
    processEcho: createEmptyProcessEcho(),
    processEchoPlayedThisTurn: false,
    buildings: [],
    openingHandDrawn: false,
    buildingsPlayedThisTurn: 0,
    turnCounter: 0
  };
}

export function createInitialGameState(): GameState {
  return {
    currentPlayerId: 'A',
    winner: null,
    mode: 'idle',
    hoverSquareKey: null,
    selectedCardHandIndex: null,
    selectedUnitId: null,
    coreMagnetPreviewUnitId: null,
    coreMagnetBulwarkTargetSquareKey: null,
    repairTargetingCasterId: null,
    overloadTargetingBuildingId: null,
    systemShockCasterId: null,
    ghostbladeTeleportCasterId: null,
    specialistEmpCasterId: null,
    pendingSystemShockLevel: null,
    pendingSystemShockSourceSlot: null,
    pendingShieldingLevel: null,
    pendingShieldingSourceSlot: null,
    pendingShimmeringLevel: null,
    pendingShimmeringSourceSlot: null,
    pendingShimmeringSquares: [],
    placingBuildingType: null,
    pendingArmorySquareKey: null,
    pendingArmoryStatusId: null,
    pendingArmoryDraftStatusIds: [],
    pendingReplicatorSquareKey: null,
    pendingReplicatorStatusId: null,
    pendingWorkshopSquareKey: null,
    pendingWorkshopStatusId: null,
    pendingDatacenterSquareKey: null,
    pendingDatacenterStatusId: null,
    pendingGearStationSquareKey: null,
    pendingGearStationStatusId: null,
    pendingAssemblyLineSquareKey: null,
    pendingAssemblyLineStatusId: null,
    pendingUpgradeBuildingId: null,
    pendingUpgradeStatusId: null,
    pendingUpgradeStatusOptions: [],
    pendingFoundationTargetBuildingId: null,
    players: {
      A: createPlayer('A'),
      B: createPlayer('B')
    },
    units: [],
    shimmeringCloaks: []
  };
}

/**
 * Swap the live state and unit-ID counter together. Used by the server when
 * routing actions to a specific room: each room owns its own ActiveStateContext,
 * which is loaded into `active` for the duration of the reducer call, then
 * snapshotted back out (the room's reference is the same object, so no copy
 * is actually needed — JS is single-threaded and the reducer runs synchronously).
 */
export function setActiveContext(ctx: ActiveStateContext): void {
  active = ctx;
}

export function getActiveContext(): ActiveStateContext {
  return active;
}

/**
 * `state` is a Proxy that delegates every read and write to the currently
 * active context. Existing engine code keeps doing `state.players.A.energy = …`
 * and never has to know about rooms or context swapping.
 *
 * This Proxy intercepts ONLY top-level access. Nested objects (state.players,
 * state.units, etc.) are returned by reference, so subsequent mutations
 * (state.players.A.energy = 5) hit the underlying object directly with no
 * proxy overhead.
 */
export const state: GameState = new Proxy({} as GameState, {
  get(_target, prop) {
    return (active.state as unknown as Record<string, unknown>)[prop as string];
  },
  set(_target, prop, value) {
    (active.state as unknown as Record<string, unknown>)[prop as string] = value;
    return true;
  },
  has(_target, prop) {
    return prop in (active.state as object);
  },
  ownKeys() {
    return Reflect.ownKeys(active.state as object);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(active.state, prop);
  },
});
