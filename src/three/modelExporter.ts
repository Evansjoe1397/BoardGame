import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createUnitVisual } from './unitVisuals.ts';
import { createBuildingVisual } from './buildingVisuals.ts';
import type { Unit, PlayerId, UnitTypeId, BuildingType } from '../types.ts';
import { UNIT_COLORS } from '../constants.ts';

// Minimal mock Unit objects for each type (just enough for createUnitVisual)
function mockUnit(unitTypeId: UnitTypeId, owner: PlayerId = 'A'): Unit {
  return {
    id: `export_${unitTypeId}`,
    owner,
    unitTypeId,
    unitName: unitTypeId,
    x: 0,
    z: 0,
    hitPoints: 10,
    maxHitPoints: 10,
    shieldHitPoints: 0,
    attackDamage: 2,
    baseAttackDamage: 2,
    additionalSystemDamagePerAttack: 0,
    attackRange: 2,
    moveRange: 3,
    movementUsedThisTurn: 0,
    overloadBonusMovementThisTurn: 0,
    hasMoved: false,
    hasAttacked: false,
    turnSummoned: false,
    canAttackAfterMove: true,
    isMeleeLocked: false,
    damageType: 'ATTACK',
    tacticalDashCooldown: 0,
    tacticalDashActiveThisTurn: false,
    coreMagnetCooldown: 0,
    coreMagnetTurnsLeft: 0,
    repairCooldown: 0,
    ghostbladeTeleportCooldown: 0,
    artillerySetUpCooldown: 0,
    artillerySetUpActive: false,
    artillerySetUpUsedThisTurn: false,
    specialistEmpCooldown: 0,
    specialistEmpUsesThisTurn: 0,
    specialistEmpPendingCooldown: false,
    tankFaceEaterAttackCooldown: 0,
    augmentedAttackBonus: 0,
    systemShockAbilityLevel: 0,
    grantedStatusIds: [],
    passiveStatuses: [],
    adjacencyStatuses: [],
    empStunnedTurns: 0,
    empStunPendingTurns: 0,
    virusAttackPenaltyActive: 0,
    virusAttackPenaltyPending: 0,
    virusDebuffPendingTurns: 0,
    virusDebuffActiveTurns: 0,
    shellGuardActive: false,
    shellGuardUsedThisTurn: false,
    tangoGuardActive: false,
    tangoArmedThisTurn: false,
    systemShockFollowUpReady: false,
    coreMagnetLastHealTurnTag: null,
    coreMagnetBulwarkCenterSquareKey: null,
  };
}

function mockBuilding(type: BuildingType, owner: PlayerId = 'A'): { owner: PlayerId; type: string; assignedStatusId?: undefined } {
  return { owner, type };
}

async function exportGroupAsGlb(group: THREE.Group, filename: string): Promise<void> {
  const exporter = new GLTFExporter();

  // Mark owner-colored materials before export
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat) {
        // Check if this is an owner-colored material (matches player A blue)
        const ownerBlue = new THREE.Color(UNIT_COLORS.A);
        if (mat.color && mat.color.equals(ownerBlue)) {
          mat.userData = { ...mat.userData, ownerColored: true };
        }
      }
    }
  });

  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.glb`;
        a.click();
        URL.revokeObjectURL(url);
        console.log(`[export] Downloaded ${filename}.glb`);
        resolve();
      },
      (error) => {
        console.error(`[export] Failed to export ${filename}:`, error);
        reject(error);
      },
      { binary: true },
    );
  });
}

export async function exportAllModels(): Promise<void> {
  console.log('[export] Starting model export...');

  const unitTypes: UnitTypeId[] = [
    'PAWN_DRONE_UNIT',
    'TANK_DRONE_UNIT',
    'SUPPORT_DRONE_UNIT',
    'GHOSTBLADE_UNIT',
    'ARTILLERY_UNIT',
    'SPECIALIST_UNIT',
  ];

  const unitFileNames: Record<string, string> = {
    PAWN_DRONE_UNIT: 'pawn_drone',
    TANK_DRONE_UNIT: 'tank_drone',
    SUPPORT_DRONE_UNIT: 'support_drone',
    GHOSTBLADE_UNIT: 'ghostblade',
    ARTILLERY_UNIT: 'artillery',
    SPECIALIST_UNIT: 'specialist',
  };

  // Export units (using player A colors as base)
  for (const typeId of unitTypes) {
    const unit = mockUnit(typeId, 'A');
    const visual = createUnitVisual(unit);
    // Name the root for identification
    visual.root.name = typeId;
    await exportGroupAsGlb(visual.root, unitFileNames[typeId]);
    // Small delay between downloads so browser doesn't block them
    await new Promise<void>(r => setTimeout(r, 300));
  }

  const buildingTypes: BuildingType[] = [
    'ARMORY', 'REPLICATOR', 'WORKSHOP',
    'DATACENTER', 'GEAR_STATION', 'ASSEMBLY_LINE',
  ];

  const buildingFileNames: Record<string, string> = {
    ARMORY: 'armory',
    REPLICATOR: 'replicator',
    WORKSHOP: 'workshop',
    DATACENTER: 'datacenter',
    GEAR_STATION: 'gear_station',
    ASSEMBLY_LINE: 'assembly_line',
  };

  // Export buildings
  for (const type of buildingTypes) {
    const building = mockBuilding(type, 'A');
    const visual = createBuildingVisual(building);
    visual.root.name = type;
    await exportGroupAsGlb(visual.root, buildingFileNames[type]);
    await new Promise<void>(r => setTimeout(r, 300));
  }

  console.log('[export] All models exported! Move .glb files to public/models/');
}

// Expose globally in dev mode
if (import.meta.env.DEV) {
  (window as unknown as Record<string, typeof exportAllModels>).__exportModels = exportAllModels;
  console.log('[dev] Model export available: __exportModels()');
}
