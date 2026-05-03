import * as THREE from 'three';
import { state } from '../state.ts';
import {
  getUnitById,
  getUnitAt,
  getCurrentPlayer,
  getSelectedUnit,
  clearSelection,
  toSquareKey,
  fromSquareKey,
  gridToWorld,
  getDistance,
  getBuildingAtSquare,
  getBaseOwnerAtSquare,
  isPlayerBaseSquare,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import {
  DAMAGE_TYPES,
  ATTACK_TYPES,
  BASE_ARTILLERY_FRONT_SQUARES
} from '../constants.ts';
import type { Building, Player, PlayerId } from '../types';

interface HitUserData {
  type: string;
  unitId?: string;
  owner?: string;
  squareKey?: string;
  x?: number;
  z?: number;
}

type HitObject = THREE.Object3D & { userData: HitUserData };
import { CARD_LIBRARY, BUILD_CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY, BUILDING_PERK_DRAFT_POOL } from '../data/statusLibrary.ts';
import { renderUI, syncBoardVisualState } from '../shared/events.ts';
import { logHint } from '../ui/log.ts';

import { applyUnitAttack, applyBaseAttack, removeUnit, destroyBase } from '../engine/combat.ts';
import {
  getUnitCurrentMoveRange,
  getUnitCurrentAttackRange,
  getUnitCurrentAttackDamage,
  unitHasStatus,
  isUnitMovementStunned,
  casterHasRepairAbility,
  applyGhostbladeShellGuard,
  hasSalvoEmpStatus,
  getSpecialistEmpCooldownTurns,
  hasBeaconCoreMagnet,
  getBulwarkAdjacentSquareKeys
} from '../engine/unitStats.ts';
import {
  getArtilleryAreaSquareKeys,
  getGaussLineSquareKeysFromTarget,
  hasBallisticStatus,
  getMinDistanceToAreaFromUnit,
  executeArtilleryBallisticAgainstUnit,
  executeArtilleryBallisticAgainstBase,
  executeArtilleryGauss,
  executeArtilleryArea
} from '../engine/artillery.ts';
import { applyProcessEchoPlayResult } from '../engine/turnManager.ts';
import {
  applyRepairAbility,
  getSystemShockTargetableEnemyUnits,
  applyShieldingEffectToUnit,
  applyShimmeringCloakSelection,
  activateCoreMagnet,
  activateBulwarkCoreMagnet,
  executeGhostbladeTeleport
} from '../engine/abilities.ts';
import {
  createBuilding,
  getBuildingDisplayName
} from '../engine/buildings.ts';
import {
  getUnitWorldPosition,
  getUnitHeadWorldPosition,
  playExplosionAt,
  playSystemShockImpact,
  playTeleportBlinkAt,
  playArtilleryShellShot,
  playArtilleryGaussBeam
} from '../three/effects.ts';

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerInputTargetingDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface InputTargetingDeps {
  getPlayerMaxEnergy?: (player: Player) => number;
}

let getPlayerMaxEnergy: (player: Player) => number = () => 30;

export function registerInputTargetingDeps(deps: InputTargetingDeps): void {
  if (deps.getPlayerMaxEnergy) getPlayerMaxEnergy = deps.getPlayerMaxEnergy;
}

// ---------------------------------------------------------------------------
// Repair Target Click
// ---------------------------------------------------------------------------

export function handleRepairTargetClick(hit: HitObject): void {
  const caster = getUnitById(state.repairTargetingCasterId!);
  if (!caster || caster.owner !== state.currentPlayerId || !casterHasRepairAbility(caster)) {
    clearSelection();
    renderUI();
    return;
  }

  if (hit.userData.type !== 'unit') {
    logHint('Select an allied drone target for Repair.');
    return;
  }

  const target = getUnitById(hit.userData.unitId!);
  if (!target) {
    return;
  }

  if (target.id === caster.id) {
    logHint('This Drone cannot target itself with Repair.');
    return;
  }

  if (target.owner !== caster.owner) {
    logHint('Repair can only target allied drones.');
    return;
  }

  if (!canPlayerDirectlyTargetUnit(state.currentPlayerId, target)) {
    logHint('This Drone is hidden by Shimmering Cloak and cannot be targeted by your abilities.');
    return;
  }

  const distance = getDistance(caster.x, caster.z, target.x, target.z);
  if (distance > caster.attackRange) {
    logHint(`Target out of Repair range (${caster.attackRange}).`);
    return;
  }

  const currentPlayer = getCurrentPlayer();
  const repairEnergyCost = unitHasStatus(caster, DRONE_STATUS_LIBRARY.SMART.id) ? 0 : 5;
  if (currentPlayer.energy < repairEnergyCost) {
    logHint('Not enough Energy to use Repair.');
    return;
  }

  if (caster.repairCooldown > 0) {
    logHint('Repair is on cooldown.');
    return;
  }

  applyRepairAbility(caster, target);
}

// ---------------------------------------------------------------------------
// System Shock Target Click
// ---------------------------------------------------------------------------

interface SystemShockContext {
  source: 'hand' | 'echo';
  level: number;
}

export function handleSystemShockTargetClick(hit: HitObject, context: SystemShockContext = { source: 'hand', level: 1 }): void {
  if (hit.userData.type === 'base') {
    logHint('System Shock cannot target enemy bases. Select an enemy drone.');
    return;
  }

  if (hit.userData.type !== 'unit') {
    logHint('Select an enemy drone target for System Shock.');
    return;
  }

  const target = getUnitById(hit.userData.unitId!);
  if (!target) {
    return;
  }
  if (target.owner === state.currentPlayerId) {
    logHint('System Shock can only target enemy drones.');
    return;
  }
  const eligibleTargets = getSystemShockTargetableEnemyUnits(state.currentPlayerId);
  const eligibleIds = new Set(eligibleTargets.map((unit) => unit.id));
  if (!eligibleIds.has(target.id)) {
    logHint('This enemy drone is not eligible for System Shock. Keep a friendly drone within attack range of it.');
    return;
  }

  const currentPlayer = getCurrentPlayer();
  const source = context.source ?? 'hand';
  const safeLevel = Math.max(1, Math.min(3, context.level ?? 1));
  if (source === 'hand') {
    if (state.selectedCardHandIndex === null) {
      clearSelection();
      renderUI();
      return;
    }
    const sourceCard = currentPlayer.hand[state.selectedCardHandIndex];
    if (!sourceCard || sourceCard.cardId !== CARD_LIBRARY.SYSTEM_SHOCK.id) {
      clearSelection();
      renderUI();
      return;
    }
    if (currentPlayer.energy < CARD_LIBRARY.SYSTEM_SHOCK.energyCost) {
      logHint('Not enough Energy to use System Shock.');
      return;
    }
    currentPlayer.energy -= CARD_LIBRARY.SYSTEM_SHOCK.energyCost;
    currentPlayer.hand.splice(state.selectedCardHandIndex, 1);
    currentPlayer.discard.push(sourceCard);
  } else {
    const slot = state.pendingSystemShockSourceSlot;
    if (!slot) {
      clearSelection();
      renderUI();
      return;
    }
    const slotCard = currentPlayer.processEcho?.[slot];
    if (!slotCard || slotCard.cardId !== CARD_LIBRARY.SYSTEM_SHOCK.id) {
      logHint('That Process Echo slot is empty.');
      clearSelection();
      renderUI();
      return;
    }
    applyProcessEchoPlayResult(currentPlayer, slot);
  }

  const shockDamage = safeLevel >= 2 ? 8 : 5;
  const targetId = target.id;
  const targetHead = getUnitHeadWorldPosition(target.id);
  const targetPos = getUnitWorldPosition(target.id);

  playSystemShockImpact(targetHead, target.id);
  const shellGuardOutcome = applyGhostbladeShellGuard(target, shockDamage, DAMAGE_TYPES.SYSTEM);
  target.hitPoints -= shellGuardOutcome.damage;
  logHint(`Player ${currentPlayer.id} cast System Shock Level ${safeLevel} on ${target.unitName} for ${shellGuardOutcome.damage} (${DAMAGE_TYPES.SYSTEM}).`);
  if (shellGuardOutcome.consumed) {
    logHint(`${target.unitName} Shell guard was consumed.`);
  }
  if (target.hitPoints <= 0) {
    logHint(`${target.unitName} of Player ${target.owner} was destroyed.`);
    playExplosionAt(targetPos);
    removeUnit(target.id);
  }

  if (safeLevel >= 3 && !getUnitById(targetId)) {
    currentPlayer.energy = Math.min(getPlayerMaxEnergy(currentPlayer), currentPlayer.energy + 10);
    logHint(`System Shock Level 3 bonus: Player ${currentPlayer.id} gained 10 Energy.`);
  }

  clearSelection();
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Shielding Target Click
// ---------------------------------------------------------------------------

export function handleShieldingTargetClick(hit: HitObject): void {
  if (hit.userData.type !== 'unit') {
    logHint('Select one of your drones to apply Shielding.');
    return;
  }

  const unit = getUnitById(hit.userData.unitId!);
  if (!unit) {
    return;
  }
  if (!canPlayerDirectlyTargetUnit(state.currentPlayerId, unit)) {
    logHint('This Drone is hidden by Shimmering Cloak and cannot be targeted by your abilities.');
    return;
  }
  if (unit.owner !== state.currentPlayerId) {
    logHint('Shielding can only target your own drones.');
    return;
  }
  if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.SALVO.id)) {
    logHint('This Drone cannot gain Shield because of Salvo status.');
    return;
  }

  if (state.mode === 'shielding_equip_instant') {
    const currentPlayer = getCurrentPlayer();
    if (state.selectedCardHandIndex === null) {
      clearSelection();
      renderUI();
      return;
    }
    const sourceCard = currentPlayer.hand[state.selectedCardHandIndex];
    if (!sourceCard || sourceCard.cardId !== CARD_LIBRARY.SHIELDING.id) {
      clearSelection();
      renderUI();
      return;
    }
    const cardTemplate = CARD_LIBRARY.SHIELDING;
    if (currentPlayer.energy < cardTemplate.energyCost) {
      logHint(`Not enough Energy to play ${cardTemplate.cardName}.`);
      return;
    }
    currentPlayer.energy -= cardTemplate.energyCost;
    currentPlayer.hand.splice(state.selectedCardHandIndex, 1);
    currentPlayer.discard.push(sourceCard);
    applyShieldingEffectToUnit(unit, 1);
    return;
  }

  if (state.mode === 'shielding_equip_echo') {
    const currentPlayer = getCurrentPlayer();
    const slot = state.pendingShieldingSourceSlot;
    const level = state.pendingShieldingLevel;
    if (!slot || !level) {
      clearSelection();
      renderUI();
      return;
    }
    const slotCard = currentPlayer.processEcho?.[slot];
    if (!slotCard || slotCard.cardId !== CARD_LIBRARY.SHIELDING.id) {
      logHint('That Process Echo slot is empty.');
      clearSelection();
      renderUI();
      return;
    }
    applyProcessEchoPlayResult(currentPlayer, slot);
    applyShieldingEffectToUnit(unit, level);
  }
}

// ---------------------------------------------------------------------------
// Shimmering Square Click
// ---------------------------------------------------------------------------

export function handleShimmeringSquareClick(hit: HitObject): void {
  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select a board square for Shimmering Cloak.');
    return;
  }
  const squareKey = hit.userData.squareKey;
  if (!squareKey) {
    return;
  }

  const level =
    state.mode === 'shimmering_targeting_instant'
      ? 1
      : Math.max(1, Math.min(3, state.pendingShimmeringLevel ?? 1));
  const requiredSquares = level >= 3 ? 2 : 1;
  const selected = state.pendingShimmeringSquares ?? [];
  if (selected.includes(squareKey)) {
    state.pendingShimmeringSquares = selected.filter((key) => key !== squareKey);
    logHint(`Removed ${squareKey} from Shimmering Cloak selection.`);
    syncBoardVisualState();
    renderUI();
    return;
  }
  state.pendingShimmeringSquares = [...selected, squareKey].slice(0, requiredSquares);
  if (state.pendingShimmeringSquares.length < requiredSquares) {
    logHint(`Selected ${squareKey}. Select ${requiredSquares - state.pendingShimmeringSquares.length} more square(s).`);
    syncBoardVisualState();
    renderUI();
    return;
  }
  applyShimmeringCloakSelection(level, state.pendingShimmeringSquares);
}

// ---------------------------------------------------------------------------
// Ghostblade Teleport Target Click
// ---------------------------------------------------------------------------

export function handleGhostbladeTeleportTargetClick(hit: HitObject): void {
  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select an empty board square for Teleport.');
    return;
  }
  const caster = getUnitById(state.ghostbladeTeleportCasterId!);
  if (!caster || caster.owner !== state.currentPlayerId || caster.unitTypeId !== 'GHOSTBLADE_UNIT') {
    clearSelection();
    renderUI();
    return;
  }
  if (caster.ghostbladeTeleportCooldown > 0) {
    logHint('Teleport is on cooldown.');
    return;
  }
  const currentPlayer = getCurrentPlayer();
  if (currentPlayer.energy < 10) {
    logHint('Not enough Energy to use Teleport.');
    return;
  }

  const squareKey = hit.userData.squareKey;
  if (!squareKey) {
    return;
  }
  if (getUnitAt(fromSquareKey(squareKey).x, fromSquareKey(squareKey).z)) {
    logHint('Teleport target must be empty.');
    return;
  }
  const baseOwner = getBaseOwnerAtSquare(squareKey);
  if (baseOwner && baseOwner !== caster.owner) {
    logHint('Teleport cannot target enemy base squares.');
    return;
  }
  const enemyBuilding = getBuildingAtSquare(caster.owner === 'A' ? 'B' : 'A', squareKey);
  const ownBuilding = getBuildingAtSquare(caster.owner, squareKey);
  if (enemyBuilding || ownBuilding) {
    logHint('Teleport target must not contain a building.');
    return;
  }

  // Visual cues live in the input layer (they are local-only animation).
  const startPos = gridToWorld(caster.x, caster.z);
  const target = fromSquareKey(squareKey);
  const targetPos = gridToWorld(target.x, target.z);
  playTeleportBlinkAt(startPos, caster.owner);
  playTeleportBlinkAt(targetPos, caster.owner);

  // Game-state mutation lives in the engine.
  executeGhostbladeTeleport(caster, squareKey);

  state.mode = 'unit_selected';
  state.ghostbladeTeleportCasterId = null;
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Artillery Attack Target Click
// ---------------------------------------------------------------------------

export function handleArtilleryAttackTargetClick(hit: HitObject): void {
  const artillery = getSelectedUnit();
  if (!artillery || artillery.owner !== state.currentPlayerId || artillery.unitTypeId !== 'ARTILLERY_UNIT') {
    clearSelection();
    renderUI();
    return;
  }
  if (!artillery.artillerySetUpActive) {
    logHint('Artillery must have Set Up status to attack.');
    return;
  }
  if (isUnitMovementStunned(artillery)) {
    logHint('This Drone is Dazzled and cannot attack this turn.');
    return;
  }
  if (artillery.hasAttacked) {
    logHint('This unit has already attacked this turn.');
    return;
  }

  const artilleryRange = getUnitCurrentAttackRange(artillery);
  const hasBallistic = hasBallisticStatus(artillery);
  if (hasBallistic) {
    if (hit.userData.type !== 'unit' && hit.userData.type !== 'base') {
      logHint('Ballistic targeting: select an enemy Drone or vulnerable enemy base square.');
      return;
    }
    if (hit.userData.type === 'unit') {
      const targetUnit = getUnitById(hit.userData.unitId!);
      if (!targetUnit || targetUnit.owner === artillery.owner) {
        logHint('Ballistic can target only enemy drones.');
        return;
      }
      const distance = getDistance(artillery.x, artillery.z, targetUnit.x, targetUnit.z);
      if (distance > artilleryRange) {
        logHint(`Ballistic target out of range (${artilleryRange}).`);
        return;
      }
      // Visual cue (client-only)
      playArtilleryShellShot(artillery.id, gridToWorld(targetUnit.x, targetUnit.z));
      // Game-state mutation lives in the engine
      executeArtilleryBallisticAgainstUnit(artillery, targetUnit);
      state.mode = 'unit_selected';
      state.hoverSquareKey = null;
      state.ghostbladeTeleportCasterId = null;
      syncBoardVisualState();
      renderUI();
      return;
    }
    const targetBaseOwner = hit.userData.owner;
    const targetSquareKey = hit.userData.squareKey;
    if (!targetBaseOwner || !targetSquareKey || targetBaseOwner === artillery.owner) {
      logHint('Ballistic can target only enemy base vulnerable squares.');
      return;
    }
    if (!BASE_ARTILLERY_FRONT_SQUARES[targetBaseOwner as PlayerId]?.has(targetSquareKey)) {
      logHint('Ballistic can only target base vulnerable frontal squares.');
      return;
    }
    const sq = fromSquareKey(targetSquareKey);
    const distance = getDistance(artillery.x, artillery.z, sq.x, sq.z);
    if (distance > artilleryRange) {
      logHint(`Ballistic base target out of range (${artilleryRange}).`);
      return;
    }
    playArtilleryShellShot(artillery.id, gridToWorld(sq.x, sq.z));
    executeArtilleryBallisticAgainstBase(artillery, targetBaseOwner as PlayerId, targetSquareKey);
    state.mode = 'unit_selected';
    state.hoverSquareKey = null;
    state.ghostbladeTeleportCasterId = null;
    syncBoardVisualState();
    renderUI();
    return;
  }

  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select a target area for Artillery.');
    return;
  }

  const hasGauss = unitHasStatus(artillery, DRONE_STATUS_LIBRARY.GAUSS.id);
  if (hasGauss) {
    const lineKeys = getGaussLineSquareKeysFromTarget(artillery, hit.userData.squareKey!);
    if (lineKeys.length === 0) {
      logHint('Gauss targeting: choose an adjacent square or one of its highlighted line squares.');
      return;
    }
    // Visual cues (client-only)
    const firstSquare = fromSquareKey(lineKeys[0]);
    const lastSquare = fromSquareKey(lineKeys[lineKeys.length - 1]);
    playArtilleryGaussBeam(
      artillery.id,
      gridToWorld(firstSquare.x, firstSquare.z),
      gridToWorld(lastSquare.x, lastSquare.z),
    );
    for (const basePlayerId of ['A', 'B'] as PlayerId[]) {
      const frontalSquares = BASE_ARTILLERY_FRONT_SQUARES[basePlayerId];
      for (const squareKey of lineKeys) {
        if (frontalSquares?.has(squareKey)) {
          const sq = fromSquareKey(squareKey);
          const pos = gridToWorld(sq.x, sq.z);
          playExplosionAt(new THREE.Vector3(pos.x, 0.5, pos.z), {
            particleCount: 14,
            duration: 0.62,
            speedMin: 1.2,
            speedMax: 2.4,
          });
        }
      }
    }
    // Engine handles damage + flag mutations + winner detection.
    executeArtilleryGauss(artillery, lineKeys);
    state.mode = 'unit_selected';
    state.hoverSquareKey = null;
    state.ghostbladeTeleportCasterId = null;
    syncBoardVisualState();
    renderUI();
    return;
  }

  const areaKeys = getArtilleryAreaSquareKeys(hit.userData.squareKey!);
  let minDistanceToArea = Number.POSITIVE_INFINITY;
  for (const squareKey of areaKeys) {
    const sq = fromSquareKey(squareKey);
    const distance = getDistance(artillery.x, artillery.z, sq.x, sq.z);
    if (distance < minDistanceToArea) {
      minDistanceToArea = distance;
    }
  }
  if (minDistanceToArea < 2) {
    logHint('Attack: Shell cannot target areas closer than 2 squares to Artillery.');
    return;
  }

  // Visual cues (client-only)
  const center = new THREE.Vector3();
  for (const key of areaKeys) {
    center.add(gridToWorld(fromSquareKey(key).x, fromSquareKey(key).z));
  }
  center.multiplyScalar(1 / areaKeys.length);
  playArtilleryShellShot(artillery.id, center);
  for (const basePlayerId of ['A', 'B'] as PlayerId[]) {
    const frontalSquares = BASE_ARTILLERY_FRONT_SQUARES[basePlayerId];
    for (const squareKey of areaKeys) {
      if (frontalSquares?.has(squareKey)) {
        const sq = fromSquareKey(squareKey);
        const pos = gridToWorld(sq.x, sq.z);
        playExplosionAt(new THREE.Vector3(pos.x, 0.5, pos.z), {
          particleCount: 14,
          duration: 0.62,
          speedMin: 1.2,
          speedMax: 2.4,
        });
      }
    }
  }
  playExplosionAt(new THREE.Vector3(center.x, 0.55, center.z), {
    particleCount: 20,
    duration: 0.8,
    speedMin: 1.2,
    speedMax: 2.9,
  });
  // Engine handles damage + flag mutations + winner detection.
  executeArtilleryArea(artillery, areaKeys);
  state.mode = 'unit_selected';
  state.hoverSquareKey = null;
  state.ghostbladeTeleportCasterId = null;
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Specialist EMP Target Click
// ---------------------------------------------------------------------------

export function handleSpecialistEmpTargetClick(hit: HitObject): void {
  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select a target area for Specialist EMP.');
    return;
  }
  const specialist = getUnitById(state.specialistEmpCasterId!);
  if (!specialist || specialist.owner !== state.currentPlayerId || specialist.unitTypeId !== 'SPECIALIST_UNIT') {
    clearSelection();
    renderUI();
    return;
  }
  if (specialist.specialistEmpCooldown > 0) {
    logHint('EMP is on cooldown.');
    return;
  }
  const hasSalvo = hasSalvoEmpStatus(specialist);
  const empUsesThisTurn = specialist.specialistEmpUsesThisTurn ?? 0;
  if (hasSalvo && empUsesThisTurn >= 2) {
    logHint('Salvo: this Specialist already used EMP twice this turn.');
    return;
  }
  if (specialist.hasAttacked && !hasSalvo) {
    logHint('Specialist cannot use EMP after attacking this turn.');
    return;
  }
  const currentPlayer = getCurrentPlayer();
  if (currentPlayer.energy < 5) {
    logHint('Not enough Energy to use EMP.');
    return;
  }

  const areaKeys = getArtilleryAreaSquareKeys(hit.userData.squareKey!);
  const specialistRange = getUnitCurrentAttackRange(specialist);
  const nearestSquareDistance = getMinDistanceToAreaFromUnit(specialist.x, specialist.z, areaKeys);
  if (nearestSquareDistance > specialistRange) {
    logHint(`EMP target area is out of range (${specialistRange}).`);
    return;
  }

  currentPlayer.energy -= 5;
  specialist.specialistEmpUsesThisTurn = empUsesThisTurn + 1;
  if (hasSalvo) {
    if (specialist.specialistEmpUsesThisTurn >= 2) {
      specialist.specialistEmpCooldown = getSpecialistEmpCooldownTurns(specialist);
      specialist.specialistEmpPendingCooldown = false;
    } else {
      specialist.specialistEmpPendingCooldown = true;
    }
  } else {
    specialist.specialistEmpCooldown = getSpecialistEmpCooldownTurns(specialist);
  }
  specialist.hasAttacked = true;

  const targets = state.units.filter((unit) => areaKeys.includes(toSquareKey(unit.x, unit.z)));
  for (const unit of targets) {
    applyUnitAttack(specialist, unit, {
      attackType: ATTACK_TYPES.EMP,
      damageType: DAMAGE_TYPES.ATTACK,
      damageAmount: 0,
      skipCoreMagnetRedirect: true,
      skipAttackVisual: true
    });
  }
  const center = new THREE.Vector3();
  for (const key of areaKeys) {
    center.add(gridToWorld(fromSquareKey(key).x, fromSquareKey(key).z));
  }
  center.multiplyScalar(1 / areaKeys.length);
  playExplosionAt(new THREE.Vector3(center.x, 0.5, center.z), {
    particleCount: 16,
    duration: 0.55,
    speedMin: 1.0,
    speedMax: 2.2
  });
  logHint(
    `${specialist.owner} Specialist used EMP on ${areaKeys.join(', ')}.` +
      (hasSalvo ? ` (Salvo uses: ${specialist.specialistEmpUsesThisTurn}/2)` : '')
  );
  state.mode = 'unit_selected';
  state.hoverSquareKey = null;
  state.specialistEmpCasterId = null;
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Core Magnet Bulwark Target Click
// ---------------------------------------------------------------------------

export function handleCoreMagnetBulwarkTargetClick(hit: HitObject): void {
  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select one adjacent square to aim Bulwark Core Magnet.');
    return;
  }
  const unit = getSelectedUnit();
  if (!unit || unit.id !== state.coreMagnetPreviewUnitId || unit.owner !== state.currentPlayerId) {
    clearSelection();
    renderUI();
    return;
  }
  const targetSquareKey = hit.userData.squareKey;
  if (!targetSquareKey) {
    return;
  }
  if (hasBeaconCoreMagnet(unit) && unit.coreMagnetTurnsLeft > 0) {
    activateCoreMagnet(unit);
    return;
  }
  const validTargets = new Set(getBulwarkAdjacentSquareKeys(unit));
  if (!validTargets.has(targetSquareKey)) {
    logHint('Choose one of the 4 adjacent highlighted squares.');
    return;
  }
  activateBulwarkCoreMagnet(unit, targetSquareKey);
}

// ---------------------------------------------------------------------------
// Building Placement Click
// ---------------------------------------------------------------------------

export function handleBuildingPlacementClick(hit: HitObject): void {
  const currentPlayer = getCurrentPlayer();
  if (!state.placingBuildingType) {
    clearSelection();
    renderUI();
    return;
  }

  if (hit.userData.type !== 'square' && hit.userData.type !== 'base') {
    logHint('Select one of your base squares to place the building.');
    return;
  }

  const squareKey = hit.userData.squareKey;
  if (!squareKey) {
    logHint('Select one of your base squares to place the building.');
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    logHint('Building can only be placed on your base squares.');
    return;
  }

  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z)) {
    logHint('Building cannot be placed on an occupied square.');
    return;
  }

  if (getBuildingAtSquare(currentPlayer.id, squareKey)) {
    logHint('A building is already active on that base square.');
    return;
  }

  const buildingCard = BUILD_CARD_LIBRARY[state.placingBuildingType];
  if (!buildingCard) {
    clearSelection();
    renderUI();
    return;
  }
  const statusPool = BUILDING_PERK_DRAFT_POOL[buildingCard.buildingType] ?? [];

  if (currentPlayer.supply < buildingCard.supplyCost) {
    logHint('Not enough Supply to build this structure.');
    return;
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.ARMORY.id) {
    if (statusPool.length > 0) {
      state.mode = 'armory_status_pick';
      state.pendingArmorySquareKey = squareKey;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      renderUI();
      return;
    }
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.REPLICATOR.id) {
    if (statusPool.length > 0) {
      state.mode = 'replicator_status_pick';
      state.pendingReplicatorSquareKey = squareKey;
      state.pendingReplicatorStatusId = null;
      renderUI();
      return;
    }
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.WORKSHOP.id) {
    if (statusPool.length > 0) {
      state.mode = 'workshop_status_pick';
      state.pendingWorkshopSquareKey = squareKey;
      state.pendingWorkshopStatusId = null;
      renderUI();
      return;
    }
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.DATACENTER.id) {
    if (statusPool.length > 0) {
      state.mode = 'datacenter_status_pick';
      state.pendingDatacenterSquareKey = squareKey;
      state.pendingDatacenterStatusId = null;
      renderUI();
      return;
    }
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.GEAR_STATION.id) {
    if (statusPool.length > 0) {
      state.mode = 'gear_station_status_pick';
      state.pendingGearStationSquareKey = squareKey;
      state.pendingGearStationStatusId = null;
      renderUI();
      return;
    }
  }

  if (buildingCard.id === BUILD_CARD_LIBRARY.ASSEMBLY_LINE.id) {
    if (statusPool.length > 0) {
      state.mode = 'assembly_line_status_pick';
      state.pendingAssemblyLineSquareKey = squareKey;
      state.pendingAssemblyLineStatusId = null;
      renderUI();
      return;
    }
  }

  currentPlayer.supply -= buildingCard.supplyCost;
  const building = createBuilding(currentPlayer.id, buildingCard.buildingType, squareKey) as unknown as Building;
  if (building.type === 'DATACENTER') {
    logHint(`Datacenter built: Player ${currentPlayer.id} max Energy increased by 5 (now ${getPlayerMaxEnergy(currentPlayer)}).`);
  }
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  logHint(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}
