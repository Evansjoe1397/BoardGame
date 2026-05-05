import type { PlayerId, StatusId, Unit, Player, Card, DamageType, ShimmeringCloak } from '../types';
import { DAMAGE_TYPES } from '../constants.ts';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import {
  toSquareKey,
  fromSquareKey,
  isInsideBoard,
  getDistance,
  getCurrentPlayer,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import { addLog, emit } from '../shared/events.ts';
import { getBuildingGrantedStatusIds } from './buildings.ts';
import { setSupply } from './playerResources.ts';

// ---------------------------------------------------------------------------
// Basic status checks
// ---------------------------------------------------------------------------

export function isUnitPlanted(unit: Unit): boolean {
  return unit.unitTypeId === 'TANK_DRONE_UNIT' && unit.coreMagnetTurnsLeft > 0;
}

export function unitHasStatus(unit: Unit | null | undefined, statusId: StatusId): boolean {
  return !!unit?.grantedStatusIds?.includes(statusId);
}

export function isUnitMovementStunned(unit: Unit | null | undefined): boolean {
  return (unit?.empStunnedTurns ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Movement / attack stat calculations
// ---------------------------------------------------------------------------

export function getUnitCurrentMoveRange(unit: Unit): number {
  let move = unit.moveRange + (unit.tacticalDashActiveThisTurn ? 1 : 0) + (unit.overloadBonusMovementThisTurn ?? 0);
  if (
    unit?.unitTypeId === 'TANK_DRONE_UNIT' &&
    unitHasStatus(unit, DRONE_STATUS_LIBRARY.ATAKK.id) &&
    unit.hitPoints >= unit.maxHitPoints
  ) {
    move += DRONE_STATUS_LIBRARY.ATAKK.effects.moveBonusAtFullHp ?? 2;
  }
  return move;
}

export function getUnitCurrentAttackRange(unit: Unit): number {
  if (unit?.isMeleeLocked) {
    return 1;
  }
  let bonus = 0;
  if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.STEADY.id) && !unit.hasMoved) {
    bonus += DRONE_STATUS_LIBRARY.STEADY.effects.rangeBonusIfDidNotMove ?? 1;
  }
  return Math.max(1, (unit.attackRange ?? 1) + bonus);
}

export function getUnitCurrentAttackDamage(unit: Unit | null | undefined): number {
  if (!unit) {
    return 0;
  }
  const base = Math.max(0, unit.attackDamage ?? 0);
  if ((unit.virusDebuffActiveTurns ?? 0) > 0) {
    return Math.max(0, base - (unit.virusAttackPenaltyActive ?? 0));
  }
  return base;
}

// ---------------------------------------------------------------------------
// Attack-after-move / Ghostblade specials
// ---------------------------------------------------------------------------

export function canUnitAttackAfterMoving(unit: Unit | null | undefined): boolean {
  if (!unit) {
    return false;
  }
  if (!unit.hasMoved) {
    return true;
  }
  if (unit.canAttackAfterMove) {
    return true;
  }
  return (
    unit.unitTypeId === 'GHOSTBLADE_UNIT' &&
    unitHasStatus(unit, DRONE_STATUS_LIBRARY.RAGE.id) &&
    unit.hitPoints < unit.maxHitPoints
  );
}

export function isTangoGhostbladeArmed(unit: Unit | null | undefined): boolean {
  return (
    !!unit &&
    unit.unitTypeId === 'GHOSTBLADE_UNIT' &&
    unitHasStatus(unit, DRONE_STATUS_LIBRARY.TANGO.id) &&
    !!unit.tangoGuardActive
  );
}

export function getTangoReactorForPosition(movingUnit: Unit | null | undefined, targetX: number, targetZ: number): Unit | null {
  if (!movingUnit) {
    return null;
  }
  const reactors = state.units.filter(
    (candidate: Unit) =>
      candidate.owner !== movingUnit.owner &&
      isTangoGhostbladeArmed(candidate)
  );
  if (!reactors.length) {
    return null;
  }
  const sorted = reactors
    .map((candidate: Unit) => ({
      unit: candidate,
      distance: getDistance(candidate.x, candidate.z, targetX, targetZ)
    }))
    .filter((entry: { unit: Unit; distance: number }) => entry.distance <= getUnitCurrentAttackRange(entry.unit))
    .sort((a: { unit: Unit; distance: number }, b: { unit: Unit; distance: number }) => a.distance - b.distance || a.unit.id.localeCompare(b.unit.id));
  return sorted.length ? sorted[0].unit : null;
}

export function triggerTangoReaction(
  reactor: Unit | null | undefined,
  movingUnit: Unit | null | undefined,
  applyUnitAttack: (attacker: Unit, target: Unit, options?: { skipAttackVisual?: boolean }) => void
): boolean {
  if (!reactor || !movingUnit) {
    return false;
  }
  reactor.tangoGuardActive = false;
  applyUnitAttack(reactor, movingUnit, { skipAttackVisual: false });
  addLog(`${reactor.owner} ${reactor.unitName} triggered Tango reaction attack.`);
  return true;
}

// ---------------------------------------------------------------------------
// Shell Guard (Ghostblade)
// ---------------------------------------------------------------------------

interface ShellGuardResult {
  damage: number;
  consumed: boolean;
  reduced: boolean;
}

export function applyGhostbladeShellGuard(unit: Unit | null | undefined, damageAmount: number, damageType: string): ShellGuardResult {
  const damage = Math.max(0, damageAmount ?? 0);
  if (
    !unit ||
    damage <= 0 ||
    unit.unitTypeId !== 'GHOSTBLADE_UNIT' ||
    !unitHasStatus(unit, DRONE_STATUS_LIBRARY.SHELL.id) ||
    !unit.shellGuardActive
  ) {
    return { damage, consumed: false, reduced: false };
  }

  unit.shellGuardActive = false;
  if (damageType === DAMAGE_TYPES.ATTACK) {
    const reduced = Math.max(0, Math.ceil(damage * 0.25));
    return { damage: reduced, consumed: true, reduced: reduced < damage };
  }
  return { damage, consumed: true, reduced: false };
}

// ---------------------------------------------------------------------------
// Workshop / Repair helpers
// ---------------------------------------------------------------------------

export function getWorkshopRepairStatusIdsForPlayer(playerId: PlayerId): StatusId[] {
  const player = state.players[playerId];
  if (!player) {
    return [];
  }
  const repairAffecting = new Set<StatusId>([
    DRONE_STATUS_LIBRARY.MECHA.id,
    DRONE_STATUS_LIBRARY.ENGINEER.id,
    DRONE_STATUS_LIBRARY.SMART.id
  ]);
  const result = new Set<StatusId>();
  for (const building of player.buildings ?? []) {
    if (building.type !== 'WORKSHOP') {
      continue;
    }
    for (const statusId of getBuildingGrantedStatusIds(building)) {
      if (repairAffecting.has(statusId)) {
        result.add(statusId);
      }
    }
  }
  return [...result];
}

export function casterHasRepairAbility(unit: Unit | null | undefined): boolean {
  if (!unit) {
    return false;
  }
  if (unit.unitTypeId === 'SUPPORT_DRONE_UNIT') {
    return true;
  }
  return unit.unitTypeId === 'SPECIALIST_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.SCHOLAR.id);
}

export function getRepairTargetableUnits(caster: Unit | null | undefined): Unit[] {
  if (!caster || !casterHasRepairAbility(caster)) {
    return [];
  }
  return state.units.filter(
    (unit: Unit) =>
      unit.owner === caster.owner &&
      unit.id !== caster.id &&
      canPlayerDirectlyTargetUnit(state.currentPlayerId, unit) &&
      getDistance(caster.x, caster.z, unit.x, unit.z) <= caster.attackRange
  );
}

// ---------------------------------------------------------------------------
// Salvo / Energize / Supply
// ---------------------------------------------------------------------------

export function hasSalvoEmpStatus(unit: Unit | null | undefined): boolean {
  return !!unit && unit.unitTypeId === 'SPECIALIST_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.SALVO.id);
}

export function hasEnergizeStatus(unit: Unit | null | undefined): boolean {
  return !!unit && unit.unitTypeId === 'PAWN_DRONE_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.ENERGIZE.id);
}

export function normalizeEnergizeSystemDamage(unit: Unit): void {
  if (!hasEnergizeStatus(unit)) {
    return;
  }
  const baseAttack = unit.baseAttackDamage ?? unit.attackDamage ?? 0;
  const currentAttack = unit.attackDamage ?? baseAttack;
  if (currentAttack > baseAttack) {
    const gainedBonus = currentAttack - baseAttack;
    unit.additionalSystemDamagePerAttack = (unit.additionalSystemDamagePerAttack ?? 0) + gainedBonus;
    unit.attackDamage = baseAttack;
  }
}

export function droneHasPlusSupplyStatus(unit: Unit | null | undefined): boolean {
  if (!unit) {
    return false;
  }
  return (unit.adjacencyStatuses as Array<{ key?: string }> ?? []).some((status) => status.key === 'adj_workshop_supply');
}

export function droneHasProviderStatus(unit: Unit | null | undefined): boolean {
  return unitHasStatus(unit, DRONE_STATUS_LIBRARY.PROVIDER.id);
}

export function awardSupplyFromDrone(player: Player, unit: Unit, baseSupply: number, reason: string = 'gain'): number {
  if (!player || !unit || baseSupply <= 0) {
    return 0;
  }
  const plusSupplyBonus = droneHasPlusSupplyStatus(unit) ? Math.floor(baseSupply * 0.5) : 0;
  const providerBonus = droneHasProviderStatus(unit) ? 3 : 0;
  const total = baseSupply + plusSupplyBonus + providerBonus;
  setSupply(player, player.supply + total);
  if (plusSupplyBonus > 0 || providerBonus > 0) {
    addLog(
      `${unit.unitName} ${reason} supply: ${baseSupply}` +
        `${plusSupplyBonus > 0 ? ` +${plusSupplyBonus} (+Supply)` : ''}` +
        `${providerBonus > 0 ? ` +${providerBonus} (Provider)` : ''}` +
        ` = ${total}.`
    );
  }
  return total;
}

// ---------------------------------------------------------------------------
// Energy cost lookup
// ---------------------------------------------------------------------------

export function getEnergyCostForUnitType(unitTypeId: string): number {
  const card = Object.values(CARD_LIBRARY).find(
    (entry) => entry.cardType === 'unit_summon' && entry.summonUnitId === unitTypeId
  );
  return card?.energyCost ?? 0;
}

// ---------------------------------------------------------------------------
// Core Magnet / Beacon helpers
// ---------------------------------------------------------------------------

export function hasBeaconCoreMagnet(unit: Unit | null | undefined): boolean {
  return !!unit && unit.unitTypeId === 'TANK_DRONE_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.BEACON.id);
}

function getCurrentTurnTag(): string {
  const currentPlayer = getCurrentPlayer();
  return `${currentPlayer.id}:${currentPlayer.turnCounter ?? 0}`;
}

export function canCoreMagnetHealThisTurn(unit: Unit): boolean {
  return unit.coreMagnetLastHealTurnTag !== getCurrentTurnTag();
}

export function markCoreMagnetHealedThisTurn(unit: Unit): void {
  unit.coreMagnetLastHealTurnTag = getCurrentTurnTag();
}

export function getTankFaceEaterAttackCooldown(unit: Unit | null | undefined): number {
  if (!unit || unit.unitTypeId !== 'TANK_DRONE_UNIT') {
    return 0;
  }
  if (!unitHasStatus(unit, DRONE_STATUS_LIBRARY.FACE_EATER.id)) {
    return 0;
  }
  return unit.tankFaceEaterAttackCooldown ?? 0;
}

// ---------------------------------------------------------------------------
// Channeling
// ---------------------------------------------------------------------------

export function hasActiveChannelingAbility(unit: Unit): boolean {
  if (!unit) {
    return false;
  }
  return isUnitPlanted(unit) || (unit.unitTypeId === 'ARTILLERY_UNIT' && !!unit.artillerySetUpActive);
}

export function breakCoreMagnetChannel(unit: Unit, reason: string = 'BREAK'): void {
  if (unit.unitTypeId !== 'TANK_DRONE_UNIT' || unit.coreMagnetTurnsLeft <= 0) {
    // Continue to check other channeling effects below.
  } else {
    unit.coreMagnetTurnsLeft = 0;
    unit.coreMagnetBulwarkCenterSquareKey = null;
    if (hasBeaconCoreMagnet(unit)) {
      unit.coreMagnetCooldown = 0;
      addLog(`${unit.owner} Tank Drone Core Magnet channel was broken by ${reason}.`);
    } else if (reason === 'EMP') {
      unit.coreMagnetCooldown = Math.max(unit.coreMagnetCooldown, 3);
      addLog(`${unit.owner} Tank Drone Core Magnet channel was broken by EMP. Cooldown restarted.`);
    } else {
      unit.coreMagnetCooldown += 2;
      addLog(`${unit.owner} Tank Drone Core Magnet channel was broken by ${reason}. Cooldown extended by 2 turns.`);
    }
  }
  if (unit.unitTypeId === 'ARTILLERY_UNIT' && unit.artillerySetUpActive) {
    unit.artillerySetUpActive = false;
    unit.artillerySetUpUsedThisTurn = true;
    if (reason === 'EMP') {
      unit.artillerySetUpCooldown = Math.max(unit.artillerySetUpCooldown, 3);
      addLog(`${unit.owner} Artillery Set Up channel was broken by EMP. Cooldown restarted.`);
    } else {
      addLog(`${unit.owner} Artillery Set Up channel was broken by ${reason}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Bulwark adjacent square keys
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Specialist EMP cooldown
// ---------------------------------------------------------------------------

export function getSpecialistEmpCooldownTurns(unit: Unit | null | undefined): number {
  if (!unit || unit.unitTypeId !== 'SPECIALIST_UNIT') {
    return 2;
  }
  let bonus = 0;
  for (const statusId of unit.grantedStatusIds ?? []) {
    bonus += DRONE_STATUS_LIBRARY[statusId]?.effects?.specialistEmpCooldownBonus ?? 0;
  }
  return Math.max(0, 2 + bonus);
}

// ---------------------------------------------------------------------------
// Shimmering Cloak
// ---------------------------------------------------------------------------

export function addShimmeringCloak(owner: PlayerId, squareKeys: string[], turnsLeft: number): void {
  const validSquares = [...new Set(squareKeys)].filter((squareKey: string) => {
    const square = fromSquareKey(squareKey);
    return isInsideBoard(square.x, square.z);
  });
  if (validSquares.length === 0) {
    return;
  }
  (state.shimmeringCloaks as Array<ShimmeringCloak & { id: string }>).push({
    id: `cloak_${owner}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    owner,
    squares: validSquares,
    turnsLeft: Math.max(1, turnsLeft)
  });
}

export function tickShimmeringCloaksForPlayer(playerId: PlayerId): void {
  let removedCount = 0;
  state.shimmeringCloaks = state.shimmeringCloaks.filter((cloak: ShimmeringCloak) => {
    if (cloak.owner !== playerId) {
      return true;
    }
    cloak.turnsLeft -= 1;
    if (cloak.turnsLeft <= 0) {
      removedCount += 1;
      return false;
    }
    return true;
  });
  if (removedCount > 0) {
    addLog(`Player ${playerId} Shimmering Cloak expired on ${removedCount} area(s).`);
  }
}

export function getShimmeringCloaksOnSquare(squareKey: string): ShimmeringCloak[] {
  return state.shimmeringCloaks.filter((cloak: ShimmeringCloak) => cloak.squares.includes(squareKey));
}

export function removeShimmeringCloakFromSquare(squareKey: string): number {
  let removedFromAreas = 0;
  const nextCloaks: ShimmeringCloak[] = [];
  for (const cloak of state.shimmeringCloaks) {
    if (!cloak.squares.includes(squareKey)) {
      nextCloaks.push(cloak);
      continue;
    }
    removedFromAreas += 1;
    const remainingSquares = cloak.squares.filter((sq: string) => sq !== squareKey);
    if (remainingSquares.length > 0) {
      nextCloaks.push({
        ...cloak,
        squares: remainingSquares
      });
    }
  }
  state.shimmeringCloaks = nextCloaks;
  return removedFromAreas;
}

// ---------------------------------------------------------------------------
// System Shock follow-up
// ---------------------------------------------------------------------------

export function consumeSystemShockFollowUp(unit: Unit | null | undefined, actionType: 'move' | 'attack'): boolean {
  if (!unit?.systemShockFollowUpReady) {
    return false;
  }
  unit.systemShockFollowUpReady = false;
  if (actionType === 'move') {
    addLog(`${unit.unitName} used System Shock momentum to move once after overloading.`);
  } else if (actionType === 'attack') {
    unit.hasAttacked = false;
    addLog(`${unit.unitName} used System Shock momentum to attack once after overloading.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Shield helpers
// ---------------------------------------------------------------------------

export function applyShieldToUnit(unit: Unit | null | undefined, shieldAmount: number, options: { allowStack?: boolean } = {}): void {
  let value = Math.max(0, Math.floor(shieldAmount));
  if (!unit || value <= 0) {
    return;
  }
  if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.SALVO.id)) {
    return;
  }
  if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.KNIGHT.id)) {
    value *= 2;
  }
  if (options.allowStack) {
    unit.shieldHitPoints = (unit.shieldHitPoints ?? 0) + value;
  } else {
    unit.shieldHitPoints = Math.max(unit.shieldHitPoints ?? 0, value);
  }
  emit({ type: 'UNIT_SHIELDED', unitId: unit.id, newShield: unit.shieldHitPoints });
}

export function removeUnitShield(unit: Unit | null | undefined): number {
  if (!unit) {
    return 0;
  }
  const removed = Math.max(0, unit.shieldHitPoints ?? 0);
  unit.shieldHitPoints = 0;
  emit({ type: 'UNIT_SHIELDED', unitId: unit.id, newShield: 0 });
  return removed;
}
