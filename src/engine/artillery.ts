import type { Unit, PlayerId, StatusId } from '../types';
import { BOARD_WIDTH, BOARD_LENGTH, DAMAGE_TYPES, BASE_ARTILLERY_FRONT_SQUARES } from '../constants.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import {
  toSquareKey,
  fromSquareKey,
  getDistance,
  getCurrentPlayer
} from '../utils.ts';
import {
  unitHasStatus,
  getUnitCurrentAttackDamage,
  getUnitCurrentMoveRange
} from './unitStats.ts';
import { applyUnitAttack, applyBaseAttack, destroyBase } from './combat.ts';
import { addLog, emit } from '../shared/events.ts';

// ---------------------------------------------------------------------------
// Artillery area helpers
// ---------------------------------------------------------------------------

export function getArtilleryAreaSquareKeys(squareKey: string): string[] {
  const origin = fromSquareKey(squareKey);
  const anchorX = Math.max(0, Math.min(BOARD_WIDTH - 2, origin.x));
  const anchorZ = Math.max(0, Math.min(BOARD_LENGTH - 2, origin.z));
  return [
    toSquareKey(anchorX, anchorZ),
    toSquareKey(anchorX + 1, anchorZ),
    toSquareKey(anchorX, anchorZ + 1),
    toSquareKey(anchorX + 1, anchorZ + 1)
  ];
}

// ---------------------------------------------------------------------------
// Gauss cannon helpers
// ---------------------------------------------------------------------------

interface GaussDirection {
  stepX: number;
  stepZ: number;
}

export function getGaussDirectionFromTargetSquare(artillery: Unit | null | undefined, squareKey: string | null | undefined): GaussDirection | null {
  if (!artillery || !squareKey) {
    return null;
  }
  const target = fromSquareKey(squareKey);
  const dx = target.x - artillery.x;
  const dz = target.z - artillery.z;
  if (dx === 0 && dz === 0) {
    return null;
  }
  const absDx = Math.abs(dx);
  const absDz = Math.abs(dz);
  const chebyshev = Math.max(absDx, absDz);
  const maxSquares = getGaussLineMaxSquares(artillery);
  if (chebyshev < 1 || chebyshev > maxSquares) {
    return null;
  }
  const aligned = dx === 0 || dz === 0 || absDx === absDz;
  if (!aligned) {
    return null;
  }
  return {
    stepX: Math.sign(dx),
    stepZ: Math.sign(dz)
  };
}

export function getGaussLineMaxSquares(artillery: Unit | null | undefined): number {
  if (!artillery) {
    return 5;
  }
  return unitHasStatus(artillery, DRONE_STATUS_LIBRARY.DRONES.id) ? 6 : 5;
}

export function getGaussLineSquareKeys(artillery: Unit, stepX: number, stepZ: number): string[] {
  if (!artillery || (stepX === 0 && stepZ === 0)) {
    return [];
  }
  const keys: string[] = [];
  const maxSquares = getGaussLineMaxSquares(artillery);
  for (let i = 1; i <= maxSquares; i += 1) {
    const x = artillery.x + stepX * i;
    const z = artillery.z + stepZ * i;
    if (x < 0 || x >= BOARD_WIDTH || z < 0 || z >= BOARD_LENGTH) {
      break;
    }
    keys.push(toSquareKey(x, z));
  }
  return keys;
}

export function getGaussLineSquareKeysFromTarget(artillery: Unit, squareKey: string): string[] {
  const direction = getGaussDirectionFromTargetSquare(artillery, squareKey);
  if (!direction) {
    return [];
  }
  return getGaussLineSquareKeys(artillery, direction.stepX, direction.stepZ);
}

// ---------------------------------------------------------------------------
// Ballistic status helpers
// ---------------------------------------------------------------------------

export function hasBallisticStatus(unit: Unit | null | undefined): boolean {
  return !!unit && unit.unitTypeId === 'ARTILLERY_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.BALLISTIC.id);
}

export function getArtilleryBallisticDamageAgainstUnit(artillery: Unit): number {
  const bonus = Math.max(0, getUnitCurrentAttackDamage(artillery) - (artillery.baseAttackDamage ?? 0));
  return Math.max(0, 10 + bonus);
}

export function getArtilleryBallisticDamageAgainstBase(artillery: Unit): number {
  const bonus = Math.max(0, getUnitCurrentAttackDamage(artillery) - (artillery.baseAttackDamage ?? 0));
  return Math.max(0, 16 + bonus);
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

export function getMinDistanceToAreaFromUnit(unitX: number, unitZ: number, areaKeys: string[]): number {
  let minDistance = Number.POSITIVE_INFINITY;
  for (const squareKey of areaKeys) {
    const square = fromSquareKey(squareKey);
    const distance = getDistance(unitX, unitZ, square.x, square.z);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

// ---------------------------------------------------------------------------
// Execute artillery — extracted from inputTargeting so the input layer no
// longer mutates artillery flags or base HP directly.
//
// All four functions assume validation has already happened upstream
// (range, target legitimacy, mode-status compatibility).
// ---------------------------------------------------------------------------

function markArtilleryFired(artillery: Unit): void {
  artillery.hasAttacked = true;
  artillery.hasMoved = true;
  artillery.movementUsedThisTurn = getUnitCurrentMoveRange(artillery);
}

/** Damage applied to a base via vulnerable-square hits in gauss/area mode.
 *  Different from applyBaseAttack — bypasses interception (it's a beam/AoE)
 *  and aggregates per-square hits into a single damage write. */
function damageBaseDirect(playerId: PlayerId, damage: number): void {
  const player = state.players[playerId];
  if (player.baseDestroyed || damage <= 0) return;
  const newHp = Math.max(0, player.baseHitPoints - damage);
  player.baseHitPoints = newHp;
  emit({ type: 'BASE_DAMAGED', player: playerId, damage, newHp });
  if (newHp <= 0) {
    destroyBase(playerId);
  }
}

export function executeArtilleryBallisticAgainstUnit(artillery: Unit, target: Unit): void {
  const ballisticDamage = getArtilleryBallisticDamageAgainstUnit(artillery);
  applyUnitAttack(artillery, target, {
    damageType: DAMAGE_TYPES.ATTACK,
    damageAmount: ballisticDamage,
    skipCoreMagnetRedirect: true,
    skipAttackVisual: true,
  });
  markArtilleryFired(artillery);
  addLog(`${artillery.owner} Artillery Ballistic struck ${target.unitName} for ${ballisticDamage}.`);
}

export function executeArtilleryBallisticAgainstBase(
  artillery: Unit,
  targetPlayerId: PlayerId,
  targetSquareKey: string,
): void {
  const ballisticBaseDamage = getArtilleryBallisticDamageAgainstBase(artillery);
  applyBaseAttack(artillery, targetPlayerId, targetSquareKey, DAMAGE_TYPES.ATTACK, ballisticBaseDamage);
  markArtilleryFired(artillery);
  addLog(
    `${artillery.owner} Artillery Ballistic struck Player ${targetPlayerId} base for ${ballisticBaseDamage}.`,
  );
}

/** Gauss beam: damages all units along a line of squares + base hits per
 *  vulnerable frontal square crossed. */
export function executeArtilleryGauss(artillery: Unit, lineKeys: string[]): void {
  const damage = getUnitCurrentAttackDamage(artillery);
  const targetUnits = state.units.filter((u) => lineKeys.includes(toSquareKey(u.x, u.z)));
  for (const unit of targetUnits) {
    applyUnitAttack(artillery, unit, {
      damageType: DAMAGE_TYPES.ATTACK,
      damageAmount: damage,
      skipCoreMagnetRedirect: true,
      skipAttackVisual: true,
    });
  }
  // Vulnerable-square explosions: emitted from the engine so both clients
  // see them (the firing client and the opponent's view).
  for (const basePlayerId of ['A', 'B'] as PlayerId[]) {
    const frontalSquares = BASE_ARTILLERY_FRONT_SQUARES[basePlayerId];
    let baseHits = 0;
    for (const squareKey of lineKeys) {
      if (frontalSquares?.has(squareKey)) {
        baseHits += 1;
        const sq = fromSquareKey(squareKey);
        emit({
          type: 'EFFECT_EXPLOSION',
          gridX: sq.x, gridZ: sq.z, y: 0.5,
          options: { particleCount: 14, duration: 0.62, speedMin: 1.2, speedMax: 2.4 },
        });
      }
    }
    if (baseHits > 0) {
      const total = damage * baseHits;
      damageBaseDirect(basePlayerId, total);
      addLog(
        `${artillery.owner} Artillery Gauss hit Player ${basePlayerId} base for ${total} via vulnerable square(s).`,
      );
    }
  }
  markArtilleryFired(artillery);
  addLog(
    `${artillery.owner} Artillery fired Gauss beam through ${lineKeys.join(', ')} for ${damage} each square.`,
  );
}

/** 2x2 standard shell: damages all units in the area + base hits per
 *  vulnerable frontal square in the area. */
export function executeArtilleryArea(artillery: Unit, areaKeys: string[]): void {
  const damage = getUnitCurrentAttackDamage(artillery);
  const targetUnits = state.units.filter((u) => areaKeys.includes(toSquareKey(u.x, u.z)));
  for (const unit of targetUnits) {
    applyUnitAttack(artillery, unit, {
      damageType: DAMAGE_TYPES.ATTACK,
      damageAmount: damage,
      skipCoreMagnetRedirect: true,
      skipAttackVisual: true,
    });
  }
  for (const basePlayerId of ['A', 'B'] as PlayerId[]) {
    const frontalSquares = BASE_ARTILLERY_FRONT_SQUARES[basePlayerId];
    let baseHits = 0;
    for (const squareKey of areaKeys) {
      if (frontalSquares?.has(squareKey)) {
        baseHits += 1;
        const sq = fromSquareKey(squareKey);
        emit({
          type: 'EFFECT_EXPLOSION',
          gridX: sq.x, gridZ: sq.z, y: 0.5,
          options: { particleCount: 14, duration: 0.62, speedMin: 1.2, speedMax: 2.4 },
        });
      }
    }
    if (baseHits > 0) {
      const total = damage * baseHits;
      damageBaseDirect(basePlayerId, total);
      addLog(
        `${artillery.owner} Artillery hit Player ${basePlayerId} base for ${total} via vulnerable square(s).`,
      );
    }
  }
  // Center burst — averaged over the 2x2 area.
  let cx = 0, cz = 0;
  for (const k of areaKeys) {
    const sq = fromSquareKey(k);
    cx += sq.x; cz += sq.z;
  }
  cx /= areaKeys.length; cz /= areaKeys.length;
  emit({
    type: 'EFFECT_EXPLOSION',
    gridX: cx, gridZ: cz, y: 0.55,
    options: { particleCount: 20, duration: 0.8, speedMin: 1.2, speedMax: 2.9 },
  });

  markArtilleryFired(artillery);
  addLog(`${artillery.owner} Artillery bombarded ${areaKeys.join(', ')} for ${damage} each square.`);
}
