import type { PlayerId, Unit, Building, BuildingType, Player, ShimmeringCloak } from './types';
import { BOARD_WIDTH, BOARD_LENGTH, WIDTH_LABELS, BASE_SQUARES } from './constants';
import { BUILD_CARD_LIBRARY } from './data/cardLibrary';
import { state } from './state';

export function shuffle<T>(cards: T[]): T[] {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function toSquareKey(x: number, z: number): string {
  return `${WIDTH_LABELS[x]}${z + 1}`;
}

export function fromSquareKey(squareKey: string): { x: number; z: number } {
  const letter = squareKey[0];
  const number = Number.parseInt(squareKey.slice(1), 10);
  return {
    x: WIDTH_LABELS.indexOf(letter),
    z: number - 1
  };
}

export function isInsideBoard(x: number, z: number): boolean {
  return x >= 0 && x < BOARD_WIDTH && z >= 0 && z < BOARD_LENGTH;
}

// gridToWorld lives in three/coords.ts (it returns a THREE.Vector3 so we
// can't host it here without dragging Three into every engine module).

export function getDistance(x1: number, z1: number, x2: number, z2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(z1 - z2));
}

export function getBaseOwnerAtSquare(squareKey: string): PlayerId | null {
  if (BASE_SQUARES.A.has(squareKey)) {
    return 'A';
  }
  if (BASE_SQUARES.B.has(squareKey)) {
    return 'B';
  }
  return null;
}

export function isActiveBaseSquare(squareKey: string): boolean {
  const isA = BASE_SQUARES.A.has(squareKey) && !state.players.A.baseDestroyed;
  const isB = BASE_SQUARES.B.has(squareKey) && !state.players.B.baseDestroyed;
  return isA || isB;
}

export function isPlayerBaseSquare(playerId: PlayerId, squareKey: string): boolean {
  return BASE_SQUARES[playerId].has(squareKey) && !state.players[playerId].baseDestroyed;
}

export function getBuildingAtSquare(playerId: PlayerId, squareKey: string): Building | null {
  return state.players[playerId].buildings.find((building) => building.squareKey === squareKey) ?? null;
}

export function getBuildingById(playerId: PlayerId, buildingId: string): Building | null {
  return state.players[playerId].buildings.find((building) => building.id === buildingId) ?? null;
}

export function getBuildingSupplyCostByType(buildingType: BuildingType): number {
  const card = Object.values(BUILD_CARD_LIBRARY).find((entry) => entry.buildingType === buildingType);
  return card?.supplyCost ?? 0;
}

export function getUnitById(unitId: string): Unit | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

export function getUnitAt(x: number, z: number): Unit | undefined {
  return state.units.find((unit) => unit.x === x && unit.z === z);
}

export function getCurrentPlayer(): Player {
  return state.players[state.currentPlayerId];
}

export function getSelectedUnit(): Unit | null {
  if (!state.selectedUnitId) {
    return null;
  }
  return getUnitById(state.selectedUnitId) || null;
}

export function getBaseCenterSquare(playerId: PlayerId): { x: number; z: number } | null {
  const squares = [...BASE_SQUARES[playerId]];
  if (squares.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumZ = 0;
  for (const squareKey of squares) {
    const square = fromSquareKey(squareKey);
    sumX += square.x;
    sumZ += square.z;
  }

  return {
    x: sumX / squares.length,
    z: sumZ / squares.length
  };
}

export function isSquareWalkable(squareKey: string): boolean {
  if (isActiveBaseSquare(squareKey)) {
    return false;
  }

  const square = fromSquareKey(squareKey);
  return !getUnitAt(square.x, square.z);
}

export function getSummonSquares(playerId: PlayerId): string[] {
  const directions: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  const valid = new Set<string>();
  for (const baseSquareKey of BASE_SQUARES[playerId]) {
    const baseSquare = fromSquareKey(baseSquareKey);
    for (const [dx, dz] of directions) {
      const x = baseSquare.x + dx;
      const z = baseSquare.z + dz;
      if (!isInsideBoard(x, z)) {
        continue;
      }

      const candidate = toSquareKey(x, z);
      if (isActiveBaseSquare(candidate)) {
        continue;
      }

      if (getUnitAt(x, z)) {
        continue;
      }

      valid.add(candidate);
    }
  }

  return [...valid];
}

export function clearSelection(): void {
  state.mode = 'idle';
  state.hoverSquareKey = null;
  state.selectedCardHandIndex = null;
  state.selectedUnitId = null;
  state.coreMagnetPreviewUnitId = null;
  state.coreMagnetBulwarkTargetSquareKey = null;
  state.repairTargetingCasterId = null;
  state.systemShockCasterId = null;
  state.ghostbladeTeleportCasterId = null;
  state.specialistEmpCasterId = null;
  state.pendingSystemShockLevel = null;
  state.pendingSystemShockSourceSlot = null;
  state.pendingShieldingLevel = null;
  state.pendingShieldingSourceSlot = null;
  state.pendingShimmeringLevel = null;
  state.pendingShimmeringSourceSlot = null;
  state.pendingShimmeringSquares = [];
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  state.pendingWorkshopSquareKey = null;
  state.pendingWorkshopStatusId = null;
  state.pendingDatacenterSquareKey = null;
  state.pendingDatacenterStatusId = null;
  state.pendingGearStationSquareKey = null;
  state.pendingGearStationStatusId = null;
  state.pendingAssemblyLineSquareKey = null;
  state.pendingAssemblyLineStatusId = null;
  state.pendingUpgradeBuildingId = null;
  state.pendingUpgradeStatusId = null;
  state.pendingUpgradeStatusOptions = [];
  state.pendingFoundationTargetBuildingId = null;
}

function getShimmeringCloaksOnSquare(squareKey: string): ShimmeringCloak[] {
  return state.shimmeringCloaks.filter((cloak) => cloak.squares.includes(squareKey));
}

export function canPlayerDirectlyTargetSquare(playerId: PlayerId, squareKey: string): boolean {
  const cloaks = getShimmeringCloaksOnSquare(squareKey);
  if (cloaks.length === 0) {
    return true;
  }
  return cloaks.some((cloak) => cloak.owner === playerId);
}

export function canPlayerDirectlyTargetUnit(playerId: PlayerId, unit: Unit | undefined | null): boolean {
  if (!unit) {
    return false;
  }
  return canPlayerDirectlyTargetSquare(playerId, toSquareKey(unit.x, unit.z));
}
