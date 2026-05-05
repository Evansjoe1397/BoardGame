import * as THREE from 'three';
import { state } from '../state.ts';
import {
  getUnitById,
  getUnitAt,
  getCurrentPlayer,
  getSelectedUnit,
  clearSelection,
  fromSquareKey,
  getDistance,
  getBuildingAtSquare,
  getBaseOwnerAtSquare,
  isPlayerBaseSquare,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import { gridToWorld } from '../three/coords.ts';
import { BASE_ARTILLERY_FRONT_SQUARES } from '../constants.ts';
import type { PlayerId } from '../types';

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
import { dispatch } from '../actionDispatcher.ts';

import {
  getUnitCurrentAttackRange,
  unitHasStatus,
  isUnitMovementStunned,
  casterHasRepairAbility,
  hasSalvoEmpStatus,
  hasBeaconCoreMagnet,
  getBulwarkAdjacentSquareKeys
} from '../engine/unitStats.ts';
import {
  getArtilleryAreaSquareKeys,
  getGaussLineSquareKeysFromTarget,
  hasBallisticStatus,
  getMinDistanceToAreaFromUnit,
} from '../engine/artillery.ts';
import { applyProcessEchoPlayResult } from '../engine/turnManager.ts';
import {
  getSystemShockTargetableEnemyUnits,
  applyShieldingEffectToUnit,
} from '../engine/abilities.ts';
import {
  getUnitHeadWorldPosition,
  playSystemShockImpact,
  playTeleportBlinkAt,
  playArtilleryShellShot,
  playArtilleryGaussBeam
} from '../three/effects.ts';

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerInputTargetingDeps() called from main.js during init.
// ---------------------------------------------------------------------------

// No late-bound deps remain — kept as a placeholder so main.ts can still
// call registerInputTargetingDeps without breaking import sites.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InputTargetingDeps {}
export function registerInputTargetingDeps(_deps: InputTargetingDeps): void {}

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

  dispatch({ type: 'ACTIVATE_REPAIR', casterUnitId: caster.id, targetUnitId: target.id });
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

  // Visual cue (client-only) — must run before the unit is potentially
  // removed by the dispatch result.
  const targetHead = getUnitHeadWorldPosition(target.id);
  playSystemShockImpact(targetHead, target.id);

  if (context.source === 'hand') {
    if (state.selectedCardHandIndex === null) {
      clearSelection();
      renderUI();
      return;
    }
    dispatch({
      type: 'PLAY_SYSTEM_SHOCK',
      casterUnitId: target.id, // unused by reducer; placeholder until casterless action shape lands
      targetUnitId: target.id,
      source: 'hand',
      handIndex: state.selectedCardHandIndex,
    });
    return;
  }

  const slot = state.pendingSystemShockSourceSlot;
  if (!slot) {
    clearSelection();
    renderUI();
    return;
  }
  dispatch({
    type: 'PLAY_SYSTEM_SHOCK',
    casterUnitId: target.id,
    targetUnitId: target.id,
    source: 'echo',
    slot: slot as '1' | '2' | '3',
  });
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
    if (state.selectedCardHandIndex === null) {
      clearSelection();
      renderUI();
      return;
    }
    dispatch({
      type: 'PLAY_SHIELDING',
      targetUnitId: unit.id,
      source: 'hand',
      handIndex: state.selectedCardHandIndex,
    });
    return;
  }

  if (state.mode === 'shielding_equip_echo') {
    const slot = state.pendingShieldingSourceSlot;
    if (!slot) {
      clearSelection();
      renderUI();
      return;
    }
    dispatch({
      type: 'PLAY_SHIELDING',
      targetUnitId: unit.id,
      source: 'echo',
      slot: slot as '1' | '2' | '3',
    });
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
  // CardSource discriminator is required by the action shape but read by the
  // engine via state.mode/pendingShimmeringSourceSlot — pass a stub here.
  if (state.mode === 'shimmering_targeting_instant') {
    dispatch({
      type: 'PLAY_SHIMMERING_CLOAK',
      squareKeys: state.pendingShimmeringSquares,
      source: 'hand',
      handIndex: state.selectedCardHandIndex ?? 0,
    });
  } else {
    dispatch({
      type: 'PLAY_SHIMMERING_CLOAK',
      squareKeys: state.pendingShimmeringSquares,
      source: 'echo',
      slot: (state.pendingShimmeringSourceSlot as '1' | '2' | '3' | null) ?? '1',
    });
  }
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

  dispatch({ type: 'GHOSTBLADE_TELEPORT', casterUnitId: caster.id, targetSquareKey: squareKey });

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
      dispatch({
        type: 'ARTILLERY_FIRE',
        unitId: artillery.id,
        mode: 'ballistic',
        targetUnitId: targetUnit.id,
      });
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
    dispatch({
      type: 'ARTILLERY_FIRE',
      unitId: artillery.id,
      mode: 'ballistic',
      targetSquareKey,
    });
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
    // Frontal-square explosions are emitted by executeArtilleryGauss as
    // EFFECT_EXPLOSION events — visible to both clients via the broadcast.
    dispatch({
      type: 'ARTILLERY_FIRE',
      unitId: artillery.id,
      mode: 'gauss',
      targetSquareKey: hit.userData.squareKey!,
    });
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

  // Shell-arc visual stays client-only — it's a flying projectile that
  // doesn't have an obvious server-side analogue. The center burst and
  // frontal-square explosions are emitted by executeArtilleryArea so
  // both clients see the impact.
  const center = new THREE.Vector3();
  for (const key of areaKeys) {
    center.add(gridToWorld(fromSquareKey(key).x, fromSquareKey(key).z));
  }
  center.multiplyScalar(1 / areaKeys.length);
  playArtilleryShellShot(artillery.id, center);
  dispatch({
    type: 'ARTILLERY_FIRE',
    unitId: artillery.id,
    mode: 'standard',
    targetSquareKey: hit.userData.squareKey!,
  });
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

  // EMP center burst is emitted as EFFECT_EXPLOSION from
  // executeSpecialistEmp so both clients see the impact.
  dispatch({
    type: 'SPECIALIST_EMP',
    casterUnitId: specialist.id,
    centerSquareKey: hit.userData.squareKey!,
  });
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
    dispatch({ type: 'ACTIVATE_CORE_MAGNET', unitId: unit.id });
    return;
  }
  const validTargets = new Set(getBulwarkAdjacentSquareKeys(unit));
  if (!validTargets.has(targetSquareKey)) {
    logHint('Choose one of the 4 adjacent highlighted squares.');
    return;
  }
  dispatch({ type: 'ACTIVATE_BULWARK_CORE_MAGNET', unitId: unit.id, centerSquareKey: targetSquareKey });
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

  dispatch({
    type: 'PLAY_BUILD_CARD',
    buildingType: buildingCard.buildingType,
    targetSquareKey: squareKey,
  });
}
