import * as THREE from 'three';
import { gridToWorld } from './coords.ts';
import type { PlayerId, UnitVisual } from '../types';
import type { ExtendedUnitVisual } from './unitVisuals';
import {
  BOARD_WIDTH,
  BOARD_LENGTH,
  TILE_SIZE,
  BASE_MAX_HIT_POINTS,
  SUPPLY_HARVEST_SQUARES,
  PURPLE_SQUARES,
  BASE_SQUARES,
  BASE_ARTILLERY_FRONT_SQUARES,
  BASE_COLORS
} from '../constants.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import {
  toSquareKey,
  fromSquareKey,
  isInsideBoard,
  getDistance,
  getBaseOwnerAtSquare,
  isSquareWalkable,
  getSummonSquares,
  getCurrentPlayer,
  getSelectedUnit,
  getUnitById,
  getUnitAt,
  getBuildingAtSquare,
  isPlayerBaseSquare,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import {
  boardGroup,
  squareMeshesByKey,
  clickableMeshes,
  unitVisualsById,
  buildingVisualsById,
  baseMeshesByPlayer,
  movementAnimations,
  getMoveRangeBorderLines,
  setMoveRangeBorderLines
} from '../visualState.ts';
import {
  unitHasStatus,
  isUnitPlanted,
  canUnitAttackAfterMoving,
  getUnitCurrentAttackRange,
  getUnitCurrentMoveRange,
  isUnitMovementStunned,
  getShimmeringCloaksOnSquare,
  getBulwarkAdjacentSquareKeys,
  getRepairTargetableUnits
} from '../engine/unitStats.ts';
import {
  getCoreMagnetCoverageSquareKeys,
  getBulwarkCoverageSquareKeys,
  getCoreMagnetOwnerCoveringSquare
} from '../engine/combat.ts';
import { getSystemShockTargetableEnemyUnits } from '../engine/abilities.ts';
import { canTargetUnitWithOverload } from '../engine/buildings.ts';
import {
  getArtilleryAreaSquareKeys,
  getGaussLineSquareKeysFromTarget,
  hasBallisticStatus,
  getMinDistanceToAreaFromUnit
} from '../engine/artillery.ts';
import { createUnitVisual } from './unitVisuals.ts';
import { createBuildingVisual } from './buildingVisuals.ts';
import {
  updateUnitStatusIcon,
  updateUnitStatusBadges,
  updateUnitHealthBars,
  updateArtillerySetUpPose,
  updateGhostbladeTangoPose,
  updateUnitFacing
} from './unitDisplay.ts';
import { resetWalkCycle } from './animation.ts';

export function initBoard(): void {
  const squareGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, 0.14, TILE_SIZE * 0.95);
  const basePlateGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.95, 0.2, TILE_SIZE * 0.95);

  for (let z = 0; z < BOARD_LENGTH; z += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const squareKey = toSquareKey(x, z);
      const owner = getBaseOwnerAtSquare(squareKey);
      const isDark = (x + z) % 2 === 0;
      const isHarvestSquare = SUPPLY_HARVEST_SQUARES.has(squareKey);
      const isPurpleSquare = PURPLE_SQUARES.has(squareKey);
      const squareMaterial = new THREE.MeshStandardMaterial({
        color: owner
          ? owner === 'A'
            ? 0x294889
            : 0x7a2730
          : isPurpleSquare
            ? isDark
              ? 0x5a2f8a
              : 0x6d3fa8
          : isHarvestSquare
            ? isDark
              ? 0xa48012
              : 0xbe9719
            : isDark
              ? 0x22303e
              : 0x2c3d4f,
        roughness: 0.85,
        metalness: 0.05
      });

      const squareMesh = new THREE.Mesh(squareGeometry, squareMaterial);
      squareMesh.receiveShadow = true;
      squareMesh.position.copy(gridToWorld(x, z));
      squareMesh.userData = {
        type: 'square',
        x,
        z,
        squareKey,
        isDark,
        isHarvestSquare,
        isPurpleSquare,
        isBaseSquare: Boolean(owner),
        owner: owner ?? null
      };

      boardGroup.add(squareMesh);
      squareMeshesByKey.set(squareKey, squareMesh);
      clickableMeshes.push(squareMesh);

      if (owner) {
        const basePlate = new THREE.Mesh(
          basePlateGeometry,
          new THREE.MeshStandardMaterial({
            color: BASE_COLORS[owner],
            roughness: 0.7,
            metalness: 0.15
          })
        );
        basePlate.position.copy(gridToWorld(x, z));
        basePlate.position.y = 0.19;
        basePlate.userData = {
          type: 'base',
          owner,
          x,
          z,
          squareKey
        };
        basePlate.castShadow = true;
        basePlate.receiveShadow = true;
        boardGroup.add(basePlate);
        clickableMeshes.push(basePlate);

        if (!baseMeshesByPlayer.has(owner)) {
          baseMeshesByPlayer.set(owner, []);
        }
        baseMeshesByPlayer.get(owner)!.push(basePlate);
      }
    }
  }
}

export function clearMoveRangeBorder(): void {
  const moveRangeBorderLines = getMoveRangeBorderLines();
  if (!moveRangeBorderLines) {
    return;
  }
  boardGroup.remove(moveRangeBorderLines);
  moveRangeBorderLines.geometry.dispose();
  (moveRangeBorderLines.material as THREE.LineBasicMaterial).dispose();
  setMoveRangeBorderLines(null);
}

export function updateMoveRangeBorder(moveTargetSquares: Set<string> | null, colorHex: number): void {
  clearMoveRangeBorder();
  if (!moveTargetSquares || moveTargetSquares.size === 0) {
    return;
  }

  const half = TILE_SIZE * 0.475;
  const y = 0.24;
  const positions = [];
  const dirs = [
    { dx: 0, dz: -1, edge: 'top' },
    { dx: 1, dz: 0, edge: 'right' },
    { dx: 0, dz: 1, edge: 'bottom' },
    { dx: -1, dz: 0, edge: 'left' }
  ];

  for (const squareKey of moveTargetSquares) {
    const sq = fromSquareKey(squareKey);
    const center = gridToWorld(sq.x, sq.z);
    for (const dir of dirs) {
      const nx = sq.x + dir.dx;
      const nz = sq.z + dir.dz;
      const neighborKey = isInsideBoard(nx, nz) ? toSquareKey(nx, nz) : null;
      if (neighborKey && moveTargetSquares.has(neighborKey)) {
        continue;
      }
      if (dir.edge === 'top') {
        positions.push(center.x - half, y, center.z - half, center.x + half, y, center.z - half);
      } else if (dir.edge === 'right') {
        positions.push(center.x + half, y, center.z - half, center.x + half, y, center.z + half);
      } else if (dir.edge === 'bottom') {
        positions.push(center.x - half, y, center.z + half, center.x + half, y, center.z + half);
      } else if (dir.edge === 'left') {
        positions.push(center.x - half, y, center.z - half, center.x - half, y, center.z + half);
      }
    }
  }

  if (positions.length === 0) {
    return;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.95
  });
  const lines = new THREE.LineSegments(geom, mat);
  setMoveRangeBorderLines(lines);
  boardGroup.add(lines);
}

export function syncBoardVisualState(): void {
  const summonSquares = state.mode === 'play_card' ? getSummonSquares(state.currentPlayerId) : [];
  const foundationTargetSquares: Set<string> =
    state.mode === 'foundation_targeting'
      ? new Set(getCurrentPlayer().buildings.map((building) => building.squareKey))
      : new Set<string>();
  const buildingPlacementSquares =
    state.mode === 'place_building' && state.placingBuildingType
      ? [...BASE_SQUARES[state.currentPlayerId]].filter((squareKey) => {
          if (!isPlayerBaseSquare(state.currentPlayerId, squareKey)) {
            return false;
          }
          if (getBuildingAtSquare(state.currentPlayerId, squareKey)) {
            return false;
          }
          const square = fromSquareKey(squareKey);
          return !getUnitAt(square.x, square.z);
        })
      : [];
  const selectedUnit = getSelectedUnit();
  const selectedUnitSquareKey = selectedUnit ? toSquareKey(selectedUnit.x, selectedUnit.z) : null;
  const previewUnit = state.coreMagnetPreviewUnitId ? getUnitById(state.coreMagnetPreviewUnitId) : null;
  const bulwarkPreviewActive =
    state.mode === 'core_magnet_bulwark_targeting' &&
    previewUnit &&
    unitHasStatus(previewUnit, DRONE_STATUS_LIBRARY.BULWARK.id);
  const bulwarkOptionSquares: Set<string> = bulwarkPreviewActive ? new Set(getBulwarkAdjacentSquareKeys(previewUnit)) : new Set<string>();
  const bulwarkPreviewCenterSquareKey = bulwarkPreviewActive
    ? state.hoverSquareKey && bulwarkOptionSquares.has(state.hoverSquareKey)
      ? state.hoverSquareKey
      : state.coreMagnetBulwarkTargetSquareKey && bulwarkOptionSquares.has(state.coreMagnetBulwarkTargetSquareKey)
        ? state.coreMagnetBulwarkTargetSquareKey
        : null
    : null;
  const previewSquares: Set<string> = previewUnit
    ? bulwarkPreviewCenterSquareKey
      ? getBulwarkCoverageSquareKeys(previewUnit, bulwarkPreviewCenterSquareKey)
      : !bulwarkPreviewActive
        ? getCoreMagnetCoverageSquareKeys(previewUnit)
        : new Set<string>()
    : new Set<string>();
  const previewOwnerColor = previewUnit?.owner === 'A' ? 0x2f72ff : 0xd73a49;
  const repairCaster =
    state.mode === 'repair_targeting' && state.repairTargetingCasterId ? getUnitById(state.repairTargetingCasterId) : null;
  const repairTargetableIds = new Set(
    repairCaster ? getRepairTargetableUnits(repairCaster).map((unit) => unit.id) : []
  );
  const overloadTargetableIds = new Set(
    state.mode === 'overload_targeting'
      ? state.units.filter((unit) => canTargetUnitWithOverload(unit)).map((unit) => unit.id)
      : []
  );
  const attackTargetingActive =
    state.mode === 'attack_targeting' &&
    selectedUnit &&
    selectedUnit.owner === state.currentPlayerId &&
    canUnitAttackAfterMoving(selectedUnit) &&
    (!selectedUnit.hasAttacked || selectedUnit.systemShockFollowUpReady) &&
    !isUnitPlanted(selectedUnit);
  const selectedAttackRange = selectedUnit ? getUnitCurrentAttackRange(selectedUnit) : 0;
  const systemShockTargetingActive =
    state.mode === 'system_shock_card' || state.mode === 'system_shock_targeting_echo';
  const shimmeringTargetingActive =
    state.mode === 'shimmering_targeting_instant' || state.mode === 'shimmering_targeting_echo';
  const selectedShimmeringSquares = new Set(state.pendingShimmeringSquares ?? []);
  const teleportCaster =
    state.mode === 'ghostblade_teleport_targeting' && state.ghostbladeTeleportCasterId ? getUnitById(state.ghostbladeTeleportCasterId) : null;
  const teleportTargetingActive =
    Boolean(teleportCaster) && teleportCaster!.owner === state.currentPlayerId && teleportCaster!.unitTypeId === 'GHOSTBLADE_UNIT';
  const artilleryPreviewSquares = (() => {
    if (state.mode !== 'artillery_attack_targeting' || !state.hoverSquareKey) {
      return new Set();
    }
    const artillery = getSelectedUnit();
    if (!artillery || artillery.unitTypeId !== 'ARTILLERY_UNIT' || artillery.owner !== state.currentPlayerId) {
      return new Set();
    }
    if (hasBallisticStatus(artillery)) {
      return new Set();
    }
    if (unitHasStatus(artillery, DRONE_STATUS_LIBRARY.GAUSS.id)) {
      return new Set(getGaussLineSquareKeysFromTarget(artillery, state.hoverSquareKey));
    }
    return new Set(getArtilleryAreaSquareKeys(state.hoverSquareKey));
  })();
  const artilleryPreviewInRange = (() => {
    if (state.mode !== 'artillery_attack_targeting' || !state.hoverSquareKey) {
      return true;
    }
    const artillery = getSelectedUnit();
    if (!artillery || artillery.unitTypeId !== 'ARTILLERY_UNIT' || artillery.owner !== state.currentPlayerId) {
      return false;
    }
    if (hasBallisticStatus(artillery)) {
      return true;
    }
    if (unitHasStatus(artillery, DRONE_STATUS_LIBRARY.GAUSS.id)) {
      return getGaussLineSquareKeysFromTarget(artillery, state.hoverSquareKey).length > 0;
    }
    const areaKeys = getArtilleryAreaSquareKeys(state.hoverSquareKey);
    const nearestDistance = getMinDistanceToAreaFromUnit(artillery.x, artillery.z, areaKeys);
    const maxRange = getUnitCurrentAttackRange(artillery);
    return nearestDistance >= 2 && nearestDistance <= maxRange;
  })();
  const specialistEmpPreviewSquares =
    state.mode === 'specialist_emp_targeting' && state.hoverSquareKey
      ? new Set(getArtilleryAreaSquareKeys(state.hoverSquareKey))
      : new Set();
  const specialistEmpPreviewInRange = (() => {
    if (state.mode !== 'specialist_emp_targeting' || !state.hoverSquareKey) {
      return true;
    }
    const specialist = state.specialistEmpCasterId ? getUnitById(state.specialistEmpCasterId) : null;
    if (!specialist || specialist.unitTypeId !== 'SPECIALIST_UNIT' || specialist.owner !== state.currentPlayerId) {
      return false;
    }
    const areaKeys = getArtilleryAreaSquareKeys(state.hoverSquareKey);
    const nearestDistance = getMinDistanceToAreaFromUnit(specialist.x, specialist.z, areaKeys);
    const maxRange = getUnitCurrentAttackRange(specialist);
    return nearestDistance <= maxRange;
  })();
  const attackTargetableUnitIds = new Set(
    attackTargetingActive
      ? state.units
          .filter(
            (unit) =>
              unit.owner !== selectedUnit.owner &&
              canPlayerDirectlyTargetUnit(state.currentPlayerId, unit) &&
              getDistance(selectedUnit.x, selectedUnit.z, unit.x, unit.z) <= selectedAttackRange
          )
          .map((unit) => unit.id)
      : []
  );
  const artilleryBallisticTargetableUnitIds = new Set(
    state.mode === 'artillery_attack_targeting' &&
      selectedUnit &&
      selectedUnit.owner === state.currentPlayerId &&
      hasBallisticStatus(selectedUnit)
      ? state.units
          .filter(
            (unit) =>
              unit.owner !== selectedUnit.owner &&
              getDistance(selectedUnit.x, selectedUnit.z, unit.x, unit.z) <= getUnitCurrentAttackRange(selectedUnit)
          )
          .map((unit) => unit.id)
      : []
  );
  const artilleryBallisticTargetableBaseSquares = new Set(
    state.mode === 'artillery_attack_targeting' &&
      selectedUnit &&
      selectedUnit.owner === state.currentPlayerId &&
      hasBallisticStatus(selectedUnit)
      ? (['A', 'B'] as PlayerId[])
          .filter((baseOwner) => baseOwner !== selectedUnit.owner)
          .flatMap((baseOwner) =>
            [...(BASE_ARTILLERY_FRONT_SQUARES[baseOwner] ?? [])].filter((squareKey) => {
              const sq = fromSquareKey(squareKey);
              return getDistance(selectedUnit.x, selectedUnit.z, sq.x, sq.z) <= getUnitCurrentAttackRange(selectedUnit);
            })
          )
      : []
  );
  const systemShockTargetableUnitIds = new Set(
    systemShockTargetingActive
      ? getSystemShockTargetableEnemyUnits(state.currentPlayerId).map((unit) => unit.id)
      : []
  );
  const selectedMoveRange = selectedUnit ? getUnitCurrentMoveRange(selectedUnit) : 0;
  const canMoveAfterAttack =
    (selectedUnit?.tacticalDashActiveThisTurn ?? false) ||
    (selectedUnit?.systemShockFollowUpReady ?? false);
  const selectedMoveRemaining =
    selectedUnit ? selectedMoveRange - (selectedUnit.movementUsedThisTurn ?? 0) : 0;
  const moveTargetSquares = new Set<string>();
  if (
    selectedUnit &&
    selectedMoveRemaining > 0 &&
    !isUnitMovementStunned(selectedUnit) &&
    (!selectedUnit.hasAttacked || canMoveAfterAttack)
  ) {
    for (const [squareKey, squareMesh] of squareMeshesByKey.entries()) {
      if (!isSquareWalkable(squareKey)) {
        continue;
      }
      if (getDistance(selectedUnit.x, selectedUnit.z, squareMesh.userData.x, squareMesh.userData.z) <= selectedMoveRemaining) {
        moveTargetSquares.add(squareKey);
      }
    }
  }
  const moveBorderColor = selectedUnit?.owner === 'A' ? 0x4da3ff : 0xff6b7a;
  updateMoveRangeBorder(moveTargetSquares, moveBorderColor);

  for (const [, mesh] of squareMeshesByKey) {
    const squareKey = mesh.userData.squareKey;
    const isSelectedSummonTarget = summonSquares.includes(squareKey);
    const isFoundationTargetSquare = foundationTargetSquares.has(squareKey);
    const isBuildingPlacementTarget = buildingPlacementSquares.includes(squareKey);
    const shimmeringCloaks = getShimmeringCloaksOnSquare(squareKey);
    const hasShimmeringCloak = shimmeringCloaks.length > 0;
    const activeCoreMagnetOwner = getCoreMagnetOwnerCoveringSquare(squareKey);
    const isCoreMagnetPreview = previewSquares.has(squareKey);
    const isBulwarkOptionSquare = bulwarkOptionSquares.has(squareKey);

    const isAttackRangeSquare =
      attackTargetingActive &&
      getDistance(selectedUnit.x, selectedUnit.z, mesh.userData.x, mesh.userData.z) <= selectedAttackRange;
    const isArtilleryBallisticBaseSquare = artilleryBallisticTargetableBaseSquares.has(squareKey);
    const isShockRangeSquare =
      systemShockTargetingActive &&
      systemShockTargetableUnitIds.size > 0 &&
      state.units.some(
        (unit) =>
          systemShockTargetableUnitIds.has(unit.id) && toSquareKey(unit.x, unit.z) === mesh.userData.squareKey
      );
    const isShimmeringTargetSquare = shimmeringTargetingActive;
    const isSelectedShimmeringSquare = selectedShimmeringSquares.has(squareKey);
    const isArtilleryPreviewSquare = artilleryPreviewSquares.has(squareKey);
    const isSpecialistEmpPreviewSquare = specialistEmpPreviewSquares.has(squareKey);
    const isOutOfRangeAreaPreviewSquare =
      (isArtilleryPreviewSquare && !artilleryPreviewInRange) ||
      (isSpecialistEmpPreviewSquare && !specialistEmpPreviewInRange);
    const isTeleportTargetSquare =
      teleportTargetingActive &&
      !getUnitAt(mesh.userData.x, mesh.userData.z) &&
      (!getBaseOwnerAtSquare(squareKey) || getBaseOwnerAtSquare(squareKey) === teleportCaster!.owner) &&
      !getBuildingAtSquare('A', squareKey) &&
      !getBuildingAtSquare('B', squareKey);
    const isSelectedUnitSquare = selectedUnitSquareKey === squareKey;
    const selectedUnitColor = selectedUnit?.owner === 'A' ? 0x2f72ff : 0xd73a49;

    const mat = mesh.material as THREE.MeshStandardMaterial;

    if (isSelectedUnitSquare) {
      mat.emissive = new THREE.Color(selectedUnitColor);
      mat.emissiveIntensity = 0.55;
    } else if (isCoreMagnetPreview) {
      mat.emissive = new THREE.Color(previewUnit!.owner === 'A' ? 0x2f72ff : 0xd73a49);
      mat.emissiveIntensity = 0.58;
    } else if (isBulwarkOptionSquare) {
      const blink = 0.26 + ((Math.sin(Date.now() * 0.012) + 1) / 2) * 0.26;
      mat.emissive = new THREE.Color(0x9ca3af);
      mat.emissiveIntensity = blink;
    } else if (activeCoreMagnetOwner) {
      mat.emissive = new THREE.Color(activeCoreMagnetOwner === 'A' ? 0x2f72ff : 0xd73a49);
      mat.emissiveIntensity = 0.3;
    } else {
      mat.emissive = new THREE.Color(
        isSelectedShimmeringSquare
          ? 0x93c5fd
          : isOutOfRangeAreaPreviewSquare
            ? 0x9ca3af
          : isSpecialistEmpPreviewSquare
            ? 0xa855f7
          : isArtilleryPreviewSquare
            ? 0xf97316
          : isTeleportTargetSquare
            ? 0x22d3ee
          : isSelectedSummonTarget
          ? 0x2f9e44
            : isAttackRangeSquare
              ? 0xb91c1c
            : isArtilleryBallisticBaseSquare
              ? 0xf97316
            : isShockRangeSquare
              ? 0x7c3aed
            : isFoundationTargetSquare
              ? 0xf59e0b
            : isBuildingPlacementTarget
              ? 0x14b8a6
              : hasShimmeringCloak
                ? 0x60a5fa
              : 0x000000
      );
      mat.emissiveIntensity =
        isSelectedShimmeringSquare ||
        isOutOfRangeAreaPreviewSquare ||
        isSpecialistEmpPreviewSquare ||
        isArtilleryPreviewSquare ||
        isSelectedSummonTarget ||
        isAttackRangeSquare ||
        isArtilleryBallisticBaseSquare ||
        isShockRangeSquare ||
        isFoundationTargetSquare ||
        isTeleportTargetSquare ||
        isBuildingPlacementTarget ||
        hasShimmeringCloak ||
        isShimmeringTargetSquare
          ? 0.45
          : 0;
    }

    if (mesh.userData.isBaseSquare) {
      const baseOwner = mesh.userData.owner as PlayerId;
      const hp = state.players[baseOwner].baseHitPoints;
      const baseMax = Math.max(1, state.players[baseOwner].baseMaxHitPoints ?? BASE_MAX_HIT_POINTS);
      const damageFactor = 1 - hp / baseMax;
      const originalColor = new THREE.Color(baseOwner === 'A' ? 0x294889 : 0x7a2730);
      const damagedColor = new THREE.Color(0x2b1b1b);
      mat.color.copy(originalColor).lerp(damagedColor, damageFactor * 0.9);
      mat.roughness = 0.82 + damageFactor * 0.16;
      mat.metalness = 0.05;
    } else {
      if (mesh.userData.isPurpleSquare) {
        mat.color.setHex(mesh.userData.isDark ? 0x5a2f8a : 0x6d3fa8);
      } else if (mesh.userData.isHarvestSquare) {
        mat.color.setHex(mesh.userData.isDark ? 0xa48012 : 0xbe9719);
      } else {
        mat.color.setHex(mesh.userData.isDark ? 0x22303e : 0x2c3d4f);
      }
      mat.roughness = 0.85;
      mat.metalness = 0.05;
    }
  }

  for (const [owner, baseMeshes] of baseMeshesByPlayer.entries()) {
    const playerData = state.players[owner];
    const hp = playerData.baseHitPoints;
    const baseMax = Math.max(1, playerData.baseMaxHitPoints ?? BASE_MAX_HIT_POINTS);
    const damageFactor = 1 - hp / baseMax;
    const start = new THREE.Color(BASE_COLORS[owner]);
    const end = new THREE.Color(0x281314);
    for (const baseMesh of baseMeshes) {
      const baseMat = baseMesh.material as THREE.MeshStandardMaterial;
      baseMat.color.copy(start).lerp(end, damageFactor * 0.9);
      baseMat.emissive = new THREE.Color(0xff3b30);
      baseMat.emissiveIntensity = damageFactor * 0.45;
      baseMat.roughness = 0.66 + damageFactor * 0.22;
    }
  }

  const aliveIds = new Set(state.units.map((unit) => unit.id));

  for (const [unitId, visual] of unitVisualsById.entries()) {
    if (!aliveIds.has(unitId)) {
      boardGroup.remove(visual.root);
      const idx = clickableMeshes.indexOf(visual.clickableMesh);
      if (idx >= 0) {
        clickableMeshes.splice(idx, 1);
      }
      unitVisualsById.delete(unitId);
    }
  }

  for (const unit of state.units) {
    let visual = unitVisualsById.get(unit.id) as ExtendedUnitVisual | undefined;
    if (!visual) {
      visual = createUnitVisual(unit);
      boardGroup.add(visual.root);
      clickableMeshes.push(visual.clickableMesh);
      unitVisualsById.set(unit.id, visual as unknown as UnitVisual);
    }

    if (!movementAnimations.has(unit.id)) {
      const position = gridToWorld(unit.x, unit.z);
      visual.root.position.set(position.x, visual.baseY ?? 0.3, position.z);
      resetWalkCycle(visual);
    }
    updateUnitFacing(visual, unit);

    visual.bodyMaterial.emissive.setHex(state.selectedUnitId === unit.id ? 0x74c0fc : 0x000000);
    visual.bodyMaterial.emissiveIntensity = state.selectedUnitId === unit.id ? 0.45 : 0;

    const unitSquareKey = toSquareKey(unit.x, unit.z);
    if (previewUnit && previewSquares.has(unitSquareKey)) {
      visual.bodyMaterial.emissive.setHex(previewOwnerColor);
      visual.bodyMaterial.emissiveIntensity = 0.55;
    } else if (overloadTargetableIds.has(unit.id)) {
      visual.bodyMaterial.emissive.setHex(0xf59e0b);
      visual.bodyMaterial.emissiveIntensity = 0.58;
    } else if (repairTargetableIds.has(unit.id)) {
      visual.bodyMaterial.emissive.setHex(0x22c55e);
      visual.bodyMaterial.emissiveIntensity = 0.55;
    } else if (attackTargetableUnitIds.has(unit.id)) {
      visual.bodyMaterial.emissive.setHex(0xef4444);
      visual.bodyMaterial.emissiveIntensity = 0.6;
    } else if (artilleryBallisticTargetableUnitIds.has(unit.id)) {
      visual.bodyMaterial.emissive.setHex(0xf97316);
      visual.bodyMaterial.emissiveIntensity = 0.62;
    } else if (systemShockTargetableUnitIds.has(unit.id)) {
      visual.bodyMaterial.emissive.setHex(0xa855f7);
      visual.bodyMaterial.emissiveIntensity = 0.62;
    }

    updateUnitStatusIcon(visual, unit);
    updateUnitStatusBadges(visual, unit);
    updateUnitHealthBars(visual, unit);
    updateArtillerySetUpPose(visual, unit);
    updateGhostbladeTangoPose(visual, unit);
    if (visual.shellGuardRing) {
      visual.shellGuardRing.visible =
        unit.unitTypeId === 'GHOSTBLADE_UNIT' &&
        unitHasStatus(unit, DRONE_STATUS_LIBRARY.SHELL.id) &&
        !!unit.shellGuardActive;
    }
    if (visual.coreMagnetDome) {
      const showBulwarkShield =
        unit.unitTypeId === 'TANK_DRONE_UNIT' &&
        unit.coreMagnetTurnsLeft > 0 &&
        unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id) &&
        !!unit.coreMagnetBulwarkCenterSquareKey;
      visual.coreMagnetDome.visible = unit.coreMagnetTurnsLeft > 0 && !showBulwarkShield;
      if (visual.bulwarkShield) {
        visual.bulwarkShield.visible = showBulwarkShield;
        if (showBulwarkShield) {
          const center = fromSquareKey(unit.coreMagnetBulwarkCenterSquareKey!);
          const dx = center.x - unit.x;
          const dz = center.z - unit.z;
          const shieldWorld = gridToWorld(center.x, center.z);
          const shieldLocal = visual.root.worldToLocal(new THREE.Vector3(shieldWorld.x, 1.66, shieldWorld.z));
          visual.bulwarkShield.position.copy(shieldLocal);
          // Keep shield parallel to covered board area in world-space (independent from unit facing).
          const desiredWorldY = Math.abs(dx) === 1 ? Math.PI / 2 : 0;
          visual.bulwarkShield.rotation.y = desiredWorldY - visual.root.rotation.y;
        }
      }
    }
  }

  const activeBuildings = [...state.players.A.buildings, ...state.players.B.buildings];
  const activeBuildingIds = new Set(activeBuildings.map((building) => building.id));

  for (const [buildingId, visual] of buildingVisualsById.entries()) {
    if (!activeBuildingIds.has(buildingId)) {
      boardGroup.remove(visual.root);
      buildingVisualsById.delete(buildingId);
    }
  }

  for (const building of activeBuildings) {
    let visual = buildingVisualsById.get(building.id);
    if (!visual) {
      const buildingResult = createBuildingVisual(building as Parameters<typeof createBuildingVisual>[0]);
      visual = buildingResult as unknown as import('../types').BuildingVisual;
      boardGroup.add(visual.root);
      buildingVisualsById.set(building.id, visual);
    }

    const square = fromSquareKey(building.squareKey);
    const worldPos = gridToWorld(square.x, square.z);
    visual.root.position.set(worldPos.x, 0.28, worldPos.z);
  }
}
