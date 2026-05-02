import * as THREE from 'three';
import { state } from '../state.ts';
import {
  getUnitById,
  getCurrentPlayer,
  getSelectedUnit,
  clearSelection,
  fromSquareKey,
  getDistance,
  getSummonSquares,
  isSquareWalkable,
  isActiveBaseSquare,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { renderUI, syncBoardVisualState } from '../bridge.ts';
import { addLog } from '../ui/log.ts';
import { camera, raycaster, mouse, renderer, pressedKeys } from '../three/sceneSetup.ts';
import { clickableMeshes } from '../visualState.ts';
import type { PlayerId, Unit } from '../types';

interface HitUserData {
  type: string;
  unitId?: string;
  owner?: string;
  squareKey?: string;
  x?: number;
  z?: number;
}

type HitObject = THREE.Object3D & { userData: HitUserData };

import { applyUnitAttack, applyBaseAttack, summonUnit } from '../engine/combat.ts';
import {
  getUnitCurrentMoveRange,
  getUnitCurrentAttackRange,
  unitHasStatus,
  isUnitPlanted,
  isUnitMovementStunned,
  hasBeaconCoreMagnet,
  canUnitAttackAfterMoving,
  getTankFaceEaterAttackCooldown,
  getTangoReactorForPosition,
  triggerTangoReaction,
  getBulwarkAdjacentSquareKeys
} from '../engine/unitStats.ts';
import { hasBallisticStatus } from '../engine/artillery.ts';
import { getCardEnergyCost } from '../engine/cards.ts';
import { dispatch } from '../actionDispatcher.ts';
import { startUnitMoveAnimation } from '../three/animation.ts';

import {
  handleRepairTargetClick,
  handleSystemShockTargetClick,
  handleShieldingTargetClick,
  handleShimmeringSquareClick,
  handleGhostbladeTeleportTargetClick,
  handleArtilleryAttackTargetClick,
  handleSpecialistEmpTargetClick,
  handleCoreMagnetBulwarkTargetClick,
  handleBuildingPlacementClick
} from './inputTargeting.ts';

import { handleOverloadTargetClick, handleFoundationTargetClick } from '../engine/buildings.ts';

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerInputHandlerDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface InputHandlerDeps {
  consumeSystemShockFollowUp?: (unit: Unit | null | undefined, actionType: 'move' | 'attack') => boolean;
}

let consumeSystemShockFollowUp: (unit: Unit | null | undefined, actionType: 'move' | 'attack') => boolean = () => false;

export function registerInputHandlerDeps(deps: InputHandlerDeps): void {
  if (deps.consumeSystemShockFollowUp) consumeSystemShockFollowUp = deps.consumeSystemShockFollowUp;
}

// ---------------------------------------------------------------------------
// Pointer / Click Handlers
// ---------------------------------------------------------------------------

export function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || state.winner) {
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersections = raycaster.intersectObjects(clickableMeshes, false);
  if (intersections.length === 0) {
    if (state.mode === 'attack_targeting') {
      addLog('Select an enemy unit or enemy base within attack range.');
      return;
    }
    if (
      state.mode === 'armory_status_pick' ||
      state.mode === 'replicator_status_pick' ||
      state.mode === 'workshop_status_pick' ||
      state.mode === 'datacenter_status_pick' ||
      state.mode === 'gear_station_status_pick' ||
      state.mode === 'assembly_line_status_pick' ||
      state.mode === 'building_upgrade_status_pick' ||
      state.mode === 'foundation_confirm'
    ) {
      return;
    }
    if (state.mode === 'harvest_absorb') {
      addLog('Select a Drone card in hand to Absorb, or click Harvest Data again to cancel.');
      return;
    }
    if (state.mode === 'system_shock_card') {
      addLog('Select an eligible enemy drone to cast System Shock Level 1, or click Process Echo X to store it.');
      return;
    }
    if (state.mode === 'shielding_card') {
      addLog('Select your drone to apply Shielding Level 1, or click Process Echo X to store Shielding.');
      return;
    }
    if (state.mode === 'shimmering_card') {
      addLog('Select a board square for Shimmering Cloak, or click Process Echo X to store it.');
      return;
    }
    if (state.mode === 'system_shock_targeting_echo') {
      addLog('Select an eligible enemy drone to cast System Shock from Process Echo.');
      return;
    }
    if (state.mode === 'shielding_equip_instant' || state.mode === 'shielding_equip_echo') {
      addLog('Select one of your drones to apply Shielding.');
      return;
    }
    if (state.mode === 'shimmering_targeting_instant' || state.mode === 'shimmering_targeting_echo') {
      addLog('Select a square for Shimmering Cloak.');
      return;
    }
    if (state.mode === 'ghostblade_teleport_targeting') {
      addLog('Select an empty square to teleport Ghostblade.');
      return;
    }
    if (state.mode === 'artillery_attack_targeting') {
      const artillery = getSelectedUnit();
      if (artillery && hasBallisticStatus(artillery)) {
        addLog('Select an enemy Drone or vulnerable enemy base square for Ballistic strike.');
      } else if (artillery && unitHasStatus(artillery, DRONE_STATUS_LIBRARY.GAUSS.id)) {
        addLog('Select an adjacent direction square (or its highlighted line) for Gauss strike.');
      } else {
        addLog('Select a 2x2 area for Artillery strike.');
      }
      return;
    }
    if (state.mode === 'specialist_emp_targeting') {
      addLog('Select a 2x2 area for Specialist EMP.');
      return;
    }
    if (state.mode === 'core_magnet_bulwark_targeting') {
      addLog('Select one adjacent square to aim Bulwark Core Magnet.');
      return;
    }
    if (state.mode === 'foundation_targeting') {
      addLog('Select one of your buildings to destroy with Foundation.');
      return;
    }
    if (state.mode === 'overload_targeting') {
      addLog('Select a friendly drone target for Overload.');
      return;
    }
    clearSelection();
    renderUI();
    return;
  }

  const hit = intersections[0].object as HitObject;
  const hitType = hit.userData.type;

  if (state.mode === 'system_shock_card') {
    handleSystemShockTargetClick(hit, { source: 'hand', level: 1 });
    return;
  }
  if (state.mode === 'shielding_card') {
    if (hitType !== 'unit') {
      addLog('Click your drone to apply Shielding Level 1, or click Process Echo X to store Shielding.');
      return;
    }
    state.mode = 'shielding_equip_instant';
    handleShieldingTargetClick(hit);
    return;
  }
  if (state.mode === 'shimmering_card') {
    if (hitType !== 'square' && hitType !== 'base') {
      addLog('Select a board square for Shimmering Cloak.');
      return;
    }
    state.mode = 'shimmering_targeting_instant';
    handleShimmeringSquareClick(hit);
    return;
  }

  if (state.mode === 'play_card') {
    handleCardTargetClick(hit);
    return;
  }

  if (state.mode === 'place_building') {
    handleBuildingPlacementClick(hit);
    return;
  }
  if (state.mode === 'foundation_targeting') {
    handleFoundationTargetClick(hit);
    return;
  }

  if (state.mode === 'repair_targeting') {
    handleRepairTargetClick(hit);
    return;
  }
  if (state.mode === 'overload_targeting') {
    handleOverloadTargetClick(hit);
    return;
  }

  if (state.mode === 'system_shock_targeting_echo') {
    handleSystemShockTargetClick(hit, { source: 'echo', level: state.pendingSystemShockLevel ?? 1 });
    return;
  }
  if (state.mode === 'shielding_equip_instant' || state.mode === 'shielding_equip_echo') {
    handleShieldingTargetClick(hit);
    return;
  }
  if (state.mode === 'shimmering_targeting_instant' || state.mode === 'shimmering_targeting_echo') {
    handleShimmeringSquareClick(hit);
    return;
  }
  if (state.mode === 'ghostblade_teleport_targeting') {
    handleGhostbladeTeleportTargetClick(hit);
    return;
  }
  if (state.mode === 'artillery_attack_targeting') {
    handleArtilleryAttackTargetClick(hit);
    return;
  }
  if (state.mode === 'specialist_emp_targeting') {
    handleSpecialistEmpTargetClick(hit);
    return;
  }
  if (state.mode === 'core_magnet_bulwark_targeting') {
    handleCoreMagnetBulwarkTargetClick(hit);
    return;
  }

  if (
    state.mode === 'armory_status_pick' ||
    state.mode === 'replicator_status_pick' ||
    state.mode === 'workshop_status_pick' ||
    state.mode === 'datacenter_status_pick' ||
    state.mode === 'gear_station_status_pick' ||
    state.mode === 'assembly_line_status_pick' ||
    state.mode === 'building_upgrade_status_pick' ||
    state.mode === 'foundation_confirm'
  ) {
    if (state.mode === 'foundation_confirm') {
      addLog('Confirm or cancel Foundation action in the prompt.');
    } else {
      addLog('Pick a Drone Status and confirm to build this factory.');
    }
    return;
  }

  if (state.mode === 'harvest_absorb') {
    addLog('Select a Drone card in hand to Absorb, or click Harvest Data again to cancel.');
    return;
  }

  if (hitType === 'unit') {
    handleUnitClick(hit.userData.unitId!);
    return;
  }

  if (hitType === 'base') {
    handleBaseClick(hit.userData.owner!, hit.userData.squareKey!);
    return;
  }

  if (hitType === 'square') {
    handleSquareClick(hit.userData.squareKey!);
  }
}

export function onPointerMove(event: PointerEvent): void {
  if (
    state.mode !== 'artillery_attack_targeting' &&
    state.mode !== 'specialist_emp_targeting' &&
    state.mode !== 'core_magnet_bulwark_targeting' &&
    state.mode !== 'shimmering_targeting_instant' &&
    state.mode !== 'shimmering_targeting_echo'
  ) {
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersections = raycaster.intersectObjects(clickableMeshes, false);
  if (intersections.length === 0) {
    if (state.hoverSquareKey) {
      state.hoverSquareKey = null;
      if (state.mode === 'core_magnet_bulwark_targeting') {
        state.coreMagnetBulwarkTargetSquareKey = null;
      }
      syncBoardVisualState();
    }
    return;
  }
  const hit = intersections[0].object as HitObject;
  const key = hit.userData.squareKey ?? null;
  if (state.hoverSquareKey !== key) {
    state.hoverSquareKey = key;
    if (state.mode === 'core_magnet_bulwark_targeting') {
      const unit = state.coreMagnetPreviewUnitId ? getUnitById(state.coreMagnetPreviewUnitId) : null;
      if (unit) {
        const options = new Set(getBulwarkAdjacentSquareKeys(unit));
        state.coreMagnetBulwarkTargetSquareKey = key && options.has(key) ? key : null;
      } else {
        state.coreMagnetBulwarkTargetSquareKey = null;
      }
    }
    syncBoardVisualState();
  }
}

// ---------------------------------------------------------------------------
// Card Target Click
// ---------------------------------------------------------------------------

export function handleCardTargetClick(hit: HitObject): void {
  const currentPlayer = getCurrentPlayer();
  if (state.selectedCardHandIndex === null) {
    clearSelection();
    renderUI();
    return;
  }
  const selectedCard = currentPlayer.hand[state.selectedCardHandIndex];
  if (!selectedCard) {
    clearSelection();
    renderUI();
    return;
  }

  const cardTemplate = CARD_LIBRARY[selectedCard.cardId];
  if (!cardTemplate || cardTemplate.cardType !== 'unit_summon') {
    addLog('This card does not target board squares.');
    return;
  }
  const targetSquare = hit.userData.squareKey;

  if (hit.userData.type !== 'square') {
    addLog('Select a board square to summon the unit.');
    return;
  }

  if (!targetSquare || !getSummonSquares(currentPlayer.id).includes(targetSquare)) {
    addLog(`Invalid summon target. Unit must be summoned adjacent to Player ${currentPlayer.id} base.`);
    return;
  }

  const cardEnergyCost = getCardEnergyCost(selectedCard);
  if (currentPlayer.energy < cardEnergyCost) {
    addLog('Not enough energy to play this card.');
    return;
  }

  currentPlayer.energy -= cardEnergyCost;
  currentPlayer.hand.splice(state.selectedCardHandIndex, 1);
  currentPlayer.discard.push(selectedCard);

  summonUnit(currentPlayer.id, targetSquare, cardTemplate.summonUnitId!, {
    ...(selectedCard.adjacencyBonuses ?? {}),
    grantedStatusIds: selectedCard.grantedStatusIds ?? []
  });
  clearSelection();
  renderUI();
}

// ---------------------------------------------------------------------------
// Unit Click
// ---------------------------------------------------------------------------

export function handleUnitClick(unitId: string): void {
  const clickedUnit = getUnitById(unitId);
  if (!clickedUnit) {
    return;
  }

  const currentPlayerId = state.currentPlayerId;
  const selectedUnit = getSelectedUnit();

  if (clickedUnit.owner === currentPlayerId) {
    state.selectedUnitId = clickedUnit.id;
    state.mode = state.mode === 'attack_targeting' ? 'attack_targeting' : 'unit_selected';
    renderUI();
    return;
  }

  if (!selectedUnit || selectedUnit.owner !== currentPlayerId) {
    addLog('Select one of your units first.');
    return;
  }

  if (!canPlayerDirectlyTargetUnit(currentPlayerId, clickedUnit)) {
    addLog('This Drone is hidden by Shimmering Cloak and cannot be directly targeted by you.');
    return;
  }

  if (isUnitPlanted(selectedUnit)) {
    if (!hasBeaconCoreMagnet(selectedUnit)) {
      addLog('This Tank Drone is planted and cannot attack while channeling Core Magnet.');
      return;
    }
  }
  if (isUnitMovementStunned(selectedUnit)) {
    addLog('This Drone is Dazzled and cannot attack this turn.');
    return;
  }

  if (selectedUnit.unitTypeId === 'ARTILLERY_UNIT' && state.mode !== 'artillery_attack_targeting') {
    addLog('Artillery can attack only through Attack: Shell ability.');
    return;
  }

  if (selectedUnit.hasMoved && !canUnitAttackAfterMoving(selectedUnit)) {
    addLog('Ghostblade cannot attack after moving unless it is damaged with Rage or gets a special improvement.');
    return;
  }
  const tankFaceEaterCooldown = getTankFaceEaterAttackCooldown(selectedUnit);
  if (tankFaceEaterCooldown > 0) {
    addLog(`Face-Eater attack cooldown: ${tankFaceEaterCooldown} turn(s) remaining.`);
    return;
  }

  if (selectedUnit.hasAttacked && !consumeSystemShockFollowUp(selectedUnit, 'attack')) {
    addLog('This unit has already attacked this turn.');
    return;
  }

  const currentAttackRange = getUnitCurrentAttackRange(selectedUnit);
  const distance = getDistance(selectedUnit.x, selectedUnit.z, clickedUnit.x, clickedUnit.z);
  if (distance > currentAttackRange) {
    addLog(`Target out of attack range (${currentAttackRange}).`);
    return;
  }

  applyUnitAttack(selectedUnit, clickedUnit);
  if (selectedUnit.unitTypeId === 'TANK_DRONE_UNIT' && unitHasStatus(selectedUnit, DRONE_STATUS_LIBRARY.FACE_EATER.id)) {
    selectedUnit.tankFaceEaterAttackCooldown = 3;
  }
  if (state.mode === 'attack_targeting') {
    state.mode = 'unit_selected';
  }
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Base Click
// ---------------------------------------------------------------------------

export function handleBaseClick(baseOwner: string, squareKey: string): void {
  const currentPlayerId = state.currentPlayerId;
  if (baseOwner === currentPlayerId) {
    addLog('That is your own base.');
    return;
  }

  const selectedUnit = getSelectedUnit();
  if (!selectedUnit || selectedUnit.owner !== currentPlayerId) {
    addLog('Select one of your units first.');
    return;
  }

  if (isUnitPlanted(selectedUnit)) {
    if (!hasBeaconCoreMagnet(selectedUnit)) {
      addLog('This Tank Drone is planted and cannot attack while channeling Core Magnet.');
      return;
    }
  }
  if (isUnitMovementStunned(selectedUnit)) {
    addLog('This Drone is Dazzled and cannot attack this turn.');
    return;
  }

  if (selectedUnit.unitTypeId === 'ARTILLERY_UNIT') {
    addLog('Artillery cannot directly target bases with Attack.');
    return;
  }

  if (selectedUnit.hasMoved && !canUnitAttackAfterMoving(selectedUnit)) {
    addLog('Ghostblade cannot attack after moving unless it is damaged with Rage or gets a special improvement.');
    return;
  }
  const tankFaceEaterCooldown = getTankFaceEaterAttackCooldown(selectedUnit);
  if (tankFaceEaterCooldown > 0) {
    addLog(`Face-Eater attack cooldown: ${tankFaceEaterCooldown} turn(s) remaining.`);
    return;
  }

  if (selectedUnit.hasAttacked && !consumeSystemShockFollowUp(selectedUnit, 'attack')) {
    addLog('This unit has already attacked this turn.');
    return;
  }

  const baseSquare = fromSquareKey(squareKey);
  const currentAttackRange = getUnitCurrentAttackRange(selectedUnit);
  const distance = getDistance(selectedUnit.x, selectedUnit.z, baseSquare.x, baseSquare.z);
  if (distance > currentAttackRange) {
    addLog(`Enemy base is out of attack range (${currentAttackRange}).`);
    return;
  }

  applyBaseAttack(selectedUnit, baseOwner as PlayerId, squareKey);
  if (selectedUnit.unitTypeId === 'TANK_DRONE_UNIT' && unitHasStatus(selectedUnit, DRONE_STATUS_LIBRARY.FACE_EATER.id)) {
    selectedUnit.tankFaceEaterAttackCooldown = 3;
  }
  if (state.mode === 'attack_targeting') {
    state.mode = 'unit_selected';
  }
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Square Click (movement)
// ---------------------------------------------------------------------------

export function handleSquareClick(squareKey: string): void {
  if (state.mode === 'attack_targeting') {
    addLog('Select an enemy unit or enemy base within attack range.');
    return;
  }

  const selectedUnit = getSelectedUnit();
  if (!selectedUnit || selectedUnit.owner !== state.currentPlayerId) {
    clearSelection();
    renderUI();
    return;
  }
  if (isUnitMovementStunned(selectedUnit)) {
    addLog('This Drone is Dazzled and cannot move this turn.');
    return;
  }

  if (isUnitPlanted(selectedUnit)) {
    addLog('This Tank Drone is planted and cannot move while channeling Core Magnet.');
    return;
  }
  if (selectedUnit.unitTypeId === 'ARTILLERY_UNIT' && selectedUnit.artillerySetUpActive) {
    addLog('Artillery cannot move while Set Up is active.');
    return;
  }

  if (selectedUnit.hasAttacked && !selectedUnit.tacticalDashActiveThisTurn) {
    if (!consumeSystemShockFollowUp(selectedUnit, 'move')) {
      addLog('This unit cannot move after attacking without Tactical Dash.');
      return;
    }
  }

  if (isActiveBaseSquare(squareKey)) {
    addLog('Units cannot move onto base squares.');
    return;
  }

  if (!isSquareWalkable(squareKey)) {
    addLog('That square is occupied or blocked.');
    return;
  }

  const target = fromSquareKey(squareKey);
  const currentMoveRange = getUnitCurrentMoveRange(selectedUnit);
  const movementUsed = selectedUnit.movementUsedThisTurn ?? 0;
  const movementRemaining = currentMoveRange - movementUsed;
  if (movementRemaining <= 0) {
    addLog('This unit has no remaining movement this turn.');
    return;
  }

  const distance = getDistance(selectedUnit.x, selectedUnit.z, target.x, target.z);
  if (distance > movementRemaining) {
    addLog(`Target out of remaining move range (${movementRemaining}).`);
    return;
  }

  const tangoReactorAtStart = getTangoReactorForPosition(selectedUnit, selectedUnit.x, selectedUnit.z);
  if (tangoReactorAtStart) {
    triggerTangoReaction(tangoReactorAtStart, selectedUnit, applyUnitAttack);
    if (!getUnitById(selectedUnit.id)) {
      syncBoardVisualState();
      renderUI();
      return;
    }
    addLog(`${selectedUnit.unitName} movement was interrupted by Tango.`);
    syncBoardVisualState();
    renderUI();
    return;
  }

  const fromX = selectedUnit.x;
  const fromZ = selectedUnit.z;
  selectedUnit.x = target.x;
  selectedUnit.z = target.z;
  selectedUnit.movementUsedThisTurn = movementUsed + distance;
  selectedUnit.hasMoved = selectedUnit.movementUsedThisTurn > 0;
  addLog(`${selectedUnit.owner} ${selectedUnit.unitName} moved to ${squareKey}.`);
  startUnitMoveAnimation(selectedUnit.id, fromX, fromZ, target.x, target.z);

  const tangoReactorAtDestination = getTangoReactorForPosition(selectedUnit, target.x, target.z);
  if (tangoReactorAtDestination) {
    triggerTangoReaction(tangoReactorAtDestination, selectedUnit, applyUnitAttack);
  }

  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Keyboard Input
// ---------------------------------------------------------------------------

export function onKeyDown(event: KeyboardEvent): void {
  if (event.code === 'Space') {
    event.preventDefault();
    dispatch({ type: 'END_TURN' });
    return;
  }

  if (event.code === 'Escape') {
    clearSelection();
    renderUI();
    return;
  }

  const code = event.code;
  if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
    pressedKeys.add(code);
  }
}

export function onKeyUp(event: KeyboardEvent): void {
  const code = event.code;
  if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
    pressedKeys.delete(code);
  }
}
