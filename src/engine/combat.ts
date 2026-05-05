import type { PlayerId, UnitTypeId, Unit, StatusId, AdjacencyBonuses, DamageType, AttackType } from '../types';
import { DAMAGE_TYPES, ATTACK_TYPES, BASE_SQUARES } from '../constants.ts';
import { UNIT_LIBRARY } from '../data/unitLibrary.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state, nextUnitId } from '../state.ts';
import { fromSquareKey, toSquareKey, isInsideBoard, getDistance } from '../utils.ts';
import { syncBoardVisualState, addLog, emit } from '../shared/events.ts';
import type { ExplosionOptions } from '../three/effects';
import {
  boardGroup,
  clickableMeshes,
  squareMeshesByKey,
  buildingVisualsById,
  baseMeshesByPlayer,
  movementAnimations
} from '../visualState.ts';

import {
  unitHasStatus,
  isUnitPlanted,
  hasEnergizeStatus,
  normalizeEnergizeSystemDamage,
  getUnitCurrentAttackDamage,
  getEnergyCostForUnitType,
  applyGhostbladeShellGuard,
  removeShimmeringCloakFromSquare,
  hasActiveChannelingAbility,
  breakCoreMagnetChannel,
  awardSupplyFromDrone
} from './unitStats.ts';
import { createStatusInstance, refreshAdjacencyBonusesForPlayerCards } from './cards.ts';

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerCombatDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface CombatDeps {
  removeUnitShield?: (unit: Unit) => number;
  refreshPlayerMaxEnergy?: (playerId: PlayerId, sync?: boolean) => number;
}

let removeUnitShield: (unit: Unit) => number = () => 0;
let refreshPlayerMaxEnergy: (playerId: PlayerId, sync?: boolean) => number = () => 0;

export function registerCombatDeps(deps: CombatDeps): void {
  if (deps.removeUnitShield) removeUnitShield = deps.removeUnitShield;
  if (deps.refreshPlayerMaxEnergy) refreshPlayerMaxEnergy = deps.refreshPlayerMaxEnergy;
}

// ---------------------------------------------------------------------------
// Effect emitters — pure events, work the same on client and server. The
// receiving client converts grid → world coords in eventApplier.
// ---------------------------------------------------------------------------

function emitRifleShot(attackerId: string, gridX: number, gridZ: number, y?: number): void {
  emit({ type: 'EFFECT_RIFLE_SHOT', attackerId, targetGridX: gridX, targetGridZ: gridZ, targetY: y });
}
function emitHit(unitId: string): void {
  emit({ type: 'EFFECT_HIT', unitId });
}
function emitExplosion(gridX: number, gridZ: number, y?: number, options?: ExplosionOptions): void {
  emit({ type: 'EFFECT_EXPLOSION', gridX, gridZ, y, options });
}

// ---------------------------------------------------------------------------
// Summon unit
// ---------------------------------------------------------------------------

interface CardBonuses {
  hpBonus?: number;
  attackBonus?: number;
  grantedStatusIds?: StatusId[];
  moveBonus?: number;
  statuses?: Array<{ key: string; glyph: string; label: string; tooltip: string }>;
}

export function summonUnit(owner: PlayerId, squareKey: string, unitTypeId: UnitTypeId, cardBonuses: CardBonuses | null = null): void {
  const template = UNIT_LIBRARY[unitTypeId];
  if (!template) {
    addLog('Cannot summon unknown unit type.');
    return;
  }
  const square = fromSquareKey(squareKey);
  const hpBonus = cardBonuses?.hpBonus ?? 0;
  const attackBonus = cardBonuses?.attackBonus ?? 0;
  const grantedStatusIds: StatusId[] = cardBonuses?.grantedStatusIds ?? [];
  const moveBonusFromAdjacency = cardBonuses?.moveBonus ?? 0;
  const grantedStatusInstances = grantedStatusIds
    .map((statusId: StatusId) => createStatusInstance(statusId))
    .filter(Boolean);
  let grantedHpBonus = 0;
  let grantedAttackBonus = 0;
  let grantedRangeDelta = 0;
  let grantedMoveBonus = 0;
  for (const statusId of grantedStatusIds) {
    const effects = DRONE_STATUS_LIBRARY[statusId]?.effects;
    grantedHpBonus += effects?.maxHitPointsBonus ?? 0;
    grantedAttackBonus += effects?.attackDamageBonus ?? 0;
    grantedRangeDelta += effects?.attackRangeDelta ?? 0;
    grantedMoveBonus += effects?.moveRangeBonus ?? 0;
  }
  const maxHitPoints = Math.max(1, template.maxHitPoints + hpBonus + grantedHpBonus);
  const computedAttackDamage = Math.max(0, template.attackDamage + attackBonus + grantedAttackBonus);
  const hasEnergizePawn = unitTypeId === 'PAWN_DRONE_UNIT' && grantedStatusIds.includes(DRONE_STATUS_LIBRARY.ENERGIZE.id);
  const systemDamagePerAttackBonus = hasEnergizePawn
    ? (DRONE_STATUS_LIBRARY.ENERGIZE.effects.systemDamagePerAttack ?? 1) + Math.max(0, computedAttackDamage - template.attackDamage)
    : 0;
  const attackDamage = hasEnergizePawn ? template.attackDamage : computedAttackDamage;
  const isMeleeLocked = template.attackRange === 1;
  const attackRange = isMeleeLocked ? 1 : Math.max(1, template.attackRange + grantedRangeDelta);
  const moveRange = Math.max(0, template.moveRange + grantedMoveBonus + moveBonusFromAdjacency);
  const adjacencyStatuses = cardBonuses?.statuses ?? [];
  const hasShellStatus = unitTypeId === 'GHOSTBLADE_UNIT' && grantedStatusIds.includes(DRONE_STATUS_LIBRARY.SHELL.id);

  state.units.push({
    id: nextUnitId(),
    owner,
    unitName: template.unitName,
    unitTypeId,
    hitPoints: maxHitPoints,
    maxHitPoints,
    shieldHitPoints: 0,
    attackDamage,
    baseAttackDamage: template.attackDamage,
    additionalSystemDamagePerAttack: systemDamagePerAttackBonus,
    attackRange,
    moveRange,
    movementUsedThisTurn: 0,
    overloadBonusMovementThisTurn: 0,
    tacticalDashCooldown: 0,
    tacticalDashActiveThisTurn: false,
    coreMagnetCooldown: 0,
    coreMagnetTurnsLeft: 0,
    coreMagnetBulwarkCenterSquareKey: null,
    coreMagnetLastHealTurnTag: null,
    repairCooldown: 0,
    ghostbladeTeleportCooldown: 0,
    specialistEmpCooldown: 0,
    specialistEmpUsesThisTurn: 0,
    specialistEmpPendingCooldown: false,
    virusAttackPenaltyPending: 0,
    virusAttackPenaltyActive: 0,
    virusDebuffPendingTurns: 0,
    virusDebuffActiveTurns: 0,
    shellGuardActive: hasShellStatus,
    tangoGuardActive: false,
    empStunnedTurns: 0,
    empStunPendingTurns: 0,
    artillerySetUpActive: false,
    artillerySetUpCooldown: 0,
    artillerySetUpUsedThisTurn: false,
    tankFaceEaterAttackCooldown: 0,
    augmentedAttackBonus: 0,
    systemShockAbilityLevel: 0,
    systemShockFollowUpReady: false,
    canAttackAfterMove: unitTypeId !== 'GHOSTBLADE_UNIT',
    isMeleeLocked,
    damageType: DAMAGE_TYPES.ATTACK,
    x: square.x,
    z: square.z,
    hasMoved: false,
    hasAttacked: false,
    adjacencyStatuses,
    passiveStatuses: grantedStatusInstances,
    grantedStatusIds
  } as unknown as Unit);

  const summoned = state.units[state.units.length - 1];
  emit({ type: 'UNIT_SUMMONED', unit: summoned });
  addLog(`Player ${owner} summoned ${template.unitName} on ${squareKey}.`);
  syncBoardVisualState();
}

// ---------------------------------------------------------------------------
// Execute unit move
// ---------------------------------------------------------------------------

/**
 * Apply a unit movement that has already been validated by the caller (range,
 * remaining-movement, walkability). Mutates state and emits UNIT_MOVED.
 *
 * Validation lives in the input layer because it depends on UI-mode context;
 * the mutation lives here so input handlers do not write to game state
 * directly.
 */
export function executeUnitMove(unit: Unit, targetX: number, targetZ: number): void {
  const fromX = unit.x;
  const fromZ = unit.z;
  const distance = getDistance(fromX, fromZ, targetX, targetZ);
  unit.x = targetX;
  unit.z = targetZ;
  unit.movementUsedThisTurn = (unit.movementUsedThisTurn ?? 0) + distance;
  unit.hasMoved = unit.movementUsedThisTurn > 0;
  addLog(`${unit.owner} ${unit.unitName} moved to ${toSquareKey(targetX, targetZ)}.`);
  emit({ type: 'UNIT_MOVED', unitId: unit.id, fromX, fromZ, toX: targetX, toZ: targetZ });
}

// ---------------------------------------------------------------------------
// Apply unit attack
// ---------------------------------------------------------------------------

interface AttackOptions {
  damageType?: string;
  attackType?: string;
  damageAmount?: number;
  skipCoreMagnetRedirect?: boolean;
  skipAttackVisual?: boolean;
  skipEnergizeBonusSystemDamage?: boolean;
  hasBreakProperty?: boolean;
}

export function applyUnitAttack(attacker: Unit, targetUnit: Unit, options: AttackOptions = {}): void {
  normalizeEnergizeSystemDamage(attacker);
  const damageType = options.damageType ?? DAMAGE_TYPES.ATTACK;
  const attackType = options.attackType ?? ATTACK_TYPES.NORMAL;
  const bypassDefenses = damageType === DAMAGE_TYPES.SYSTEM;
  let resolvedTarget = targetUnit;
  if (!options.skipCoreMagnetRedirect && !bypassDefenses) {
    const interception = getCoreMagnetInterception(attacker, targetUnit.x, targetUnit.z);
    if (interception?.type === 'block') {
      const impactSquare = fromSquareKey(interception.impactSquareKey);
      emitRifleShot(attacker.id, impactSquare.x, impactSquare.z, 0.85);
      emitExplosion(impactSquare.x, impactSquare.z, 0.85, { particleCount: 10, duration: 0.45, speedMin: 0.8, speedMax: 1.6 });
      attacker.hasAttacked = true;
      addLog('Bulwark Core Magnet shield blocked the shot.');
      return;
    }
    if (interception?.type === 'redirect' && interception.unit.id !== targetUnit.id) {
      resolvedTarget = interception.unit;
      addLog(`Core Magnet redirected the shot to ${interception.unit.unitName}.`);
    }
  }

  if (!options.skipAttackVisual) {
    emitRifleShot(attacker.id, resolvedTarget.x, resolvedTarget.z, 0.85);
  }
  emitHit(resolvedTarget.id);

  let damage = options.damageAmount ?? getUnitCurrentAttackDamage(attacker);
  if (
    !bypassDefenses &&
    isUnitPlanted(resolvedTarget) &&
    resolvedTarget.grantedStatusIds?.includes(DRONE_STATUS_LIBRARY.GROUNDED.id)
  ) {
    damage = Math.max(0, damage - 1);
  }
  if (attackType !== ATTACK_TYPES.EMP) {
    const shellGuardOutcome = applyGhostbladeShellGuard(resolvedTarget, damage, damageType);
    damage = shellGuardOutcome.damage;
    if (shellGuardOutcome.consumed) {
      if (shellGuardOutcome.reduced) {
        addLog(`${resolvedTarget.unitName} Shell reduced incoming Attack damage by 75%.`);
      } else {
        addLog(`${resolvedTarget.unitName} Shell guard was consumed.`);
      }
    }
  }

  let damageToHealth = damage;
  if (attackType === ATTACK_TYPES.EMP) {
    damageToHealth = 0;
    const dispelledShield = removeUnitShield(resolvedTarget);
    if (dispelledShield > 0) {
      damageToHealth += dispelledShield;
      addLog(`${resolvedTarget.unitName} lost ${dispelledShield} Shield from EMP.`);
    }
    const cloakRemoved = removeShimmeringCloakFromSquare(toSquareKey(resolvedTarget.x, resolvedTarget.z));
    if (cloakRemoved > 0) {
      addLog(`EMP removed Shimmering Cloak from ${toSquareKey(resolvedTarget.x, resolvedTarget.z)}.`);
    }
    const hadActiveChanneling = hasActiveChannelingAbility(resolvedTarget);
    if (hadActiveChanneling) {
      breakCoreMagnetChannel(resolvedTarget, 'EMP');
      resolvedTarget.empStunnedTurns = Math.max(resolvedTarget.empStunnedTurns ?? 0, 1);
      resolvedTarget.empStunPendingTurns = 0;
      addLog(`${resolvedTarget.unitName} became Dazzled and cannot move or attack for 1 turn.`);
    }
  } else if (!bypassDefenses) {
    const shieldBefore = resolvedTarget.shieldHitPoints ?? 0;
    if (shieldBefore > 0 && damageToHealth > 0) {
      const absorbed = Math.min(shieldBefore, damageToHealth);
      resolvedTarget.shieldHitPoints = shieldBefore - absorbed;
      damageToHealth -= absorbed;
      addLog(`${resolvedTarget.unitName} absorbed ${absorbed} damage with Shield.`);
    }
  }

  if (attackType === ATTACK_TYPES.EMP) {
    const shellGuardOutcome = applyGhostbladeShellGuard(resolvedTarget, damageToHealth, damageType);
    damageToHealth = shellGuardOutcome.damage;
    if (shellGuardOutcome.consumed) {
      addLog(`${resolvedTarget.unitName} Shell guard was consumed.`);
    }
  }

  resolvedTarget.hitPoints -= damageToHealth;
  if (options.hasBreakProperty) {
    breakCoreMagnetChannel(resolvedTarget, 'BREAK');
  }
  attacker.hasAttacked = true;
  addLog(
    `${attacker.owner} ${attacker.unitName} hit enemy ${resolvedTarget.unitName} for ${Math.max(0, damageToHealth)} (${damageType}${attackType !== ATTACK_TYPES.NORMAL ? `, ${attackType}` : ''}).`
  );

  if (
    attackType === ATTACK_TYPES.NORMAL &&
    attacker.unitTypeId === 'SPECIALIST_UNIT' &&
    unitHasStatus(attacker, DRONE_STATUS_LIBRARY.VIRUS.id) &&
    resolvedTarget.owner !== attacker.owner &&
    resolvedTarget.hitPoints > 0
  ) {
    const penalty = Math.max(0, getUnitCurrentAttackDamage(attacker));
    if (penalty > 0) {
      resolvedTarget.virusAttackPenaltyPending = Math.max(resolvedTarget.virusAttackPenaltyPending ?? 0, penalty);
      resolvedTarget.virusDebuffPendingTurns = Math.max(resolvedTarget.virusDebuffPendingTurns ?? 0, 1);
      addLog(`${resolvedTarget.unitName} was infected with Virus: -${penalty} ATT on its next turn.`);
    }
  }

  if (
    hasEnergizeStatus(attacker) &&
    attackType === ATTACK_TYPES.NORMAL &&
    !options.skipEnergizeBonusSystemDamage &&
    resolvedTarget.hitPoints > 0
  ) {
    const bonusSystemDamage = Math.max(0, attacker.additionalSystemDamagePerAttack ?? 0);
    if (bonusSystemDamage > 0) {
      resolvedTarget.hitPoints -= bonusSystemDamage;
      addLog(`${attacker.unitName} Energize dealt ${bonusSystemDamage} bonus System damage.`);
    }
  }

  // Granular damage event — receiving clients use this to update hp/shield
  // without needing a full snapshot.
  emit({
    type: 'UNIT_DAMAGED',
    unitId: resolvedTarget.id,
    damage: damageToHealth,
    newHp: resolvedTarget.hitPoints,
    newShield: resolvedTarget.shieldHitPoints,
    damageType: damageType as DamageType,
  });

  if (resolvedTarget.hitPoints <= 0) {
    if (attacker.owner === state.currentPlayerId && attacker.owner !== resolvedTarget.owner) {
      const defeatedEnergy = getEnergyCostForUnitType(resolvedTarget.unitTypeId);
      const baseKillSupply = Math.floor(defeatedEnergy * 0.5);
      if (baseKillSupply > 0) {
        const ownerPlayer = state.players[attacker.owner];
        const gained = awardSupplyFromDrone(ownerPlayer, attacker, baseKillSupply, 'kill');
        addLog(
          `Player ${attacker.owner} gained ${gained} Supply for destroying ${resolvedTarget.unitName} (base ${baseKillSupply}).`
        );
      }
    }
    addLog(`${resolvedTarget.unitName} of Player ${resolvedTarget.owner} was destroyed.`);
    emitExplosion(resolvedTarget.x, resolvedTarget.z, 0.5);
    removeUnit(resolvedTarget.id);
  }
}

// ---------------------------------------------------------------------------
// Apply base attack
// ---------------------------------------------------------------------------

export function applyBaseAttack(attacker: Unit, targetPlayerId: PlayerId, targetSquareKey: string, damageType: string = DAMAGE_TYPES.ATTACK, damageAmount: number | null = null): void {
  const bypassDefenses = damageType === DAMAGE_TYPES.SYSTEM;
  const targetSquare = fromSquareKey(targetSquareKey);
  if (!bypassDefenses) {
    const interception = getCoreMagnetInterception(attacker, targetSquare.x, targetSquare.z);
    if (interception?.type === 'block') {
      const impactSquare = fromSquareKey(interception.impactSquareKey);
      emitRifleShot(attacker.id, impactSquare.x, impactSquare.z, 0.85);
      emitExplosion(impactSquare.x, impactSquare.z, 0.85, { particleCount: 10, duration: 0.45, speedMin: 0.8, speedMax: 1.6 });
      attacker.hasAttacked = true;
      addLog('Bulwark Core Magnet shield blocked the shot.');
      return;
    }
    if (interception?.type === 'redirect') {
      addLog('Core Magnet redirected the shot away from the base.');
      applyUnitAttack(attacker, interception.unit, {
        skipCoreMagnetRedirect: true,
        damageType
      });
      return;
    }
  }

  const baseOwner = state.players[targetPlayerId];
  const damage = Math.max(0, damageAmount ?? getUnitCurrentAttackDamage(attacker));
  const appliedDamage = damageType === DAMAGE_TYPES.SYSTEM ? 0 : damage;
  if (damageType === DAMAGE_TYPES.SYSTEM) {
    addLog(`System Damage does not affect Player ${targetPlayerId} base.`);
  }
  baseOwner.baseHitPoints = Math.max(0, baseOwner.baseHitPoints - appliedDamage);
  attacker.hasAttacked = true;
  emit({
    type: 'BASE_DAMAGED',
    player: targetPlayerId,
    damage: appliedDamage,
    newHp: baseOwner.baseHitPoints,
  });

  emitRifleShot(attacker.id, targetSquare.x, targetSquare.z, 0.3);
  emitExplosion(targetSquare.x, targetSquare.z, 0.3, { particleCount: 16, duration: 0.62, speedMin: 1.3, speedMax: 2.6 });

  addLog(`${attacker.owner} ${attacker.unitName} hit Player ${targetPlayerId} base for ${appliedDamage} (${damageType}).`);

  if (baseOwner.baseHitPoints <= 0) {
    destroyBase(targetPlayerId);
    state.winner = attacker.owner;
    addLog(`Player ${attacker.owner} wins by destroying Player ${targetPlayerId} base.`);
  }
}

// ---------------------------------------------------------------------------
// Core Magnet interception
// ---------------------------------------------------------------------------

interface Interception {
  type: 'block' | 'redirect';
  unit: Unit;
  impactSquareKey: string;
  score: number;
}

export function getCoreMagnetInterception(attacker: Unit, targetX: number, targetZ: number): Interception | null {
  const shotPath = getSquaresAlongLine(attacker.x, attacker.z, targetX, targetZ);
  const candidates = state.units.filter(
    (unit: Unit) =>
      unit.owner !== attacker.owner &&
      unit.unitTypeId === 'TANK_DRONE_UNIT' &&
      unit.coreMagnetTurnsLeft > 0 &&
      unit.hitPoints > 0
  );

  let best: Interception | null = null;
  for (const candidate of candidates) {
    const coveredSquares = getCoreMagnetCoverageSquareKeys(candidate);
    let firstHitIndex = -1;
    for (let i = 1; i < shotPath.length; i += 1) {
      if (coveredSquares.has(shotPath[i])) {
        firstHitIndex = i;
        break;
      }
    }
    if (firstHitIndex < 0) {
      continue;
    }
    const interceptionType: 'block' | 'redirect' = unitHasStatus(candidate, DRONE_STATUS_LIBRARY.BULWARK.id) ? 'block' : 'redirect';
    const score = firstHitIndex;
    if (
      !best ||
      score < best.score ||
      (score === best.score &&
        interceptionType === 'redirect' &&
        best.type === 'redirect' &&
        getDistance(attacker.x, attacker.z, candidate.x, candidate.z) <
          getDistance(attacker.x, attacker.z, best.unit.x, best.unit.z))
    ) {
      best = {
        type: interceptionType,
        unit: candidate,
        impactSquareKey: shotPath[firstHitIndex],
        score
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Core Magnet coverage
// ---------------------------------------------------------------------------

export function getCoreMagnetCoverageSquareKeys(unit: Unit): Set<string> {
  if (
    unit.unitTypeId === 'TANK_DRONE_UNIT' &&
    unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id) &&
    unit.coreMagnetBulwarkCenterSquareKey
  ) {
    return getBulwarkCoverageSquareKeys(unit, unit.coreMagnetBulwarkCenterSquareKey as string);
  }
  const keys = new Set<string>();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const x = unit.x + dx;
      const z = unit.z + dz;
      if (isInsideBoard(x, z)) {
        keys.add(toSquareKey(x, z));
      }
    }
  }
  return keys;
}

export function getBulwarkAdjacentSquareKeys(unit: Unit): string[] {
  const keys: string[] = [];
  const directions: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  for (const [dx, dz] of directions) {
    const x = unit.x + dx;
    const z = unit.z + dz;
    if (isInsideBoard(x, z)) {
      keys.push(toSquareKey(x, z));
    }
  }
  return keys;
}

export function getBulwarkCoverageSquareKeys(unit: Unit, centerSquareKey: string): Set<string> {
  const center = fromSquareKey(centerSquareKey);
  const dx = center.x - unit.x;
  const dz = center.z - unit.z;
  if (Math.abs(dx) + Math.abs(dz) !== 1) {
    return new Set<string>();
  }

  const keys = new Set<string>([centerSquareKey]);
  const leftX = center.x - dz;
  const leftZ = center.z + dx;
  const rightX = center.x + dz;
  const rightZ = center.z - dx;
  if (isInsideBoard(leftX, leftZ)) {
    keys.add(toSquareKey(leftX, leftZ));
  }
  if (isInsideBoard(rightX, rightZ)) {
    keys.add(toSquareKey(rightX, rightZ));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Line drawing
// ---------------------------------------------------------------------------

export function getSquaresAlongLine(x0: number, z0: number, x1: number, z1: number): string[] {
  const squares: string[] = [];
  let x = x0;
  let z = z0;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;

  while (true) {
    squares.push(toSquareKey(x, z));
    if (x === x1 && z === z1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
  }

  return squares;
}

// ---------------------------------------------------------------------------
// Remove unit
// ---------------------------------------------------------------------------

export function removeUnit(unitId: string): void {
  emit({ type: 'UNIT_DESTROYED', unitId });
  state.units = state.units.filter((unit: Unit) => unit.id !== unitId);
  movementAnimations.delete(unitId);
  if (state.selectedUnitId === unitId) {
    state.selectedUnitId = null;
  }
  if (state.coreMagnetPreviewUnitId === unitId) {
    state.coreMagnetPreviewUnitId = null;
  }
  if (state.repairTargetingCasterId === unitId) {
    state.repairTargetingCasterId = null;
  }
  if (state.systemShockCasterId === unitId) {
    state.systemShockCasterId = null;
  }
  if (state.ghostbladeTeleportCasterId === unitId) {
    state.ghostbladeTeleportCasterId = null;
  }
  if (state.specialistEmpCasterId === unitId) {
    state.specialistEmpCasterId = null;
  }
}

// ---------------------------------------------------------------------------
// Destroy base
// ---------------------------------------------------------------------------

export function destroyBase(playerId: PlayerId): void {
  const player = state.players[playerId];
  if (player.baseDestroyed) {
    return;
  }

  player.baseDestroyed = true;

  // Setting state.winner is part of base destruction — never the input layer's
  // job. Emits GAME_OVER for receiving clients.
  if (!state.winner) {
    const winner: PlayerId = playerId === 'A' ? 'B' : 'A';
    state.winner = winner;
    emit({ type: 'BASE_DESTROYED', player: playerId });
    addLog(`Player ${winner} wins by destroying Player ${playerId} base.`);
  }

  const baseMeshes = baseMeshesByPlayer.get(playerId) ?? [];
  for (const mesh of baseMeshes) {
    boardGroup.remove(mesh);
    const idx = clickableMeshes.indexOf(mesh);
    if (idx >= 0) {
      clickableMeshes.splice(idx, 1);
    }
  }
  baseMeshesByPlayer.set(playerId, []);

  for (const squareKey of BASE_SQUARES[playerId]) {
    const squareMesh = squareMeshesByKey.get(squareKey);
    if (!squareMesh) {
      continue;
    }
    squareMesh.userData.isBaseSquare = false;
    squareMesh.userData.owner = null;
  }

  player.buildings = [];
  refreshAdjacencyBonusesForPlayerCards(playerId);
  refreshPlayerMaxEnergy(playerId, true);
  for (const [buildingId, visual] of buildingVisualsById.entries()) {
    if (visual.owner !== playerId) {
      continue;
    }
    boardGroup.remove(visual.root);
    buildingVisualsById.delete(buildingId);
  }

  addLog(`Player ${playerId} base was destroyed and removed from the field.`);
}

// ---------------------------------------------------------------------------
// Core Magnet ownership check
// ---------------------------------------------------------------------------

export function getCoreMagnetOwnerCoveringSquare(squareKey: string): PlayerId | null {
  for (const unit of state.units) {
    if (unit.unitTypeId !== 'TANK_DRONE_UNIT' || unit.coreMagnetTurnsLeft <= 0) {
      continue;
    }
    const coveredSquares = getCoreMagnetCoverageSquareKeys(unit);
    if (coveredSquares.has(squareKey)) {
      return unit.owner;
    }
  }
  return null;
}
