import { COMPANY_NAMES } from '../constants.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { state } from '../state.ts';
import {
  getAdjacencyBonusesForProducedCard,
  areBuildingsSideAdjacent,
} from '../engine/cards.ts';
import {
  getBuildingGrantedStatusIds,
} from '../engine/buildings.ts';
import type { Building, BuildingType, PlayerId, Player } from '../types';

function isWorkshopAdjacentToDatacenter(playerId: PlayerId, datacenterBuildingId: string): boolean {
  const player = state.players[playerId];
  const datacenter = player.buildings.find((building) => building.id === datacenterBuildingId && building.type === 'DATACENTER');
  if (!datacenter) {
    return false;
  }
  return player.buildings.some(
    (building) => building.type === 'WORKSHOP' && areBuildingsSideAdjacent(datacenter, building)
  );
}

export function getBuildingBaseName(buildingType: string): string {
  if (buildingType === 'ARMORY') {
    return 'The Armory';
  }
  if (buildingType === 'REPLICATOR') {
    return 'The Replicator';
  }
  if (buildingType === 'WORKSHOP') {
    return 'The Workshop';
  }
  if (buildingType === 'DATACENTER') {
    return 'Datacenter';
  }
  if (buildingType === 'GEAR_STATION') {
    return 'Gear Station';
  }
  if (buildingType === 'ASSEMBLY_LINE') {
    return 'Assembly Line';
  }
  return buildingType;
}

export function getRandomCompanyName(): string {
  const index = Math.floor(Math.random() * COMPANY_NAMES.length);
  return COMPANY_NAMES[index];
}

export function getBuildingDisplayName(building: Building): string {
  if (building.displayName) {
    return building.displayName;
  }
  const baseName = getBuildingBaseName(building.type);
  if (building.companyName) {
    return `${baseName} ${building.companyName}`;
  }
  return baseName;
}

interface Badge {
  glyph: string;
  tooltip: string;
}

export function getBuildingAdjacencyBadge(buildingType: string): Badge | null {
  if (buildingType === 'ARMORY') {
    return { glyph: '+HP', tooltip: 'Adjacency: +1 HP to drone cards produced by adjacent buildings.' };
  }
  if (buildingType === 'REPLICATOR') {
    return { glyph: '+ATT', tooltip: 'Adjacency: +1 ATT to drone cards produced by adjacent buildings.' };
  }
  if (buildingType === 'WORKSHOP') {
    return { glyph: '$', tooltip: 'Adjacency: +50% Supply yield for drone cards produced by adjacent buildings.' };
  }
  if (buildingType === 'GEAR_STATION') {
    return { glyph: '+MOV', tooltip: 'Adjacency: +1 MOV to drone cards produced by adjacent buildings.' };
  }
  if (buildingType === 'ASSEMBLY_LINE') {
    return { glyph: '-ENG', tooltip: 'Adjacency: Drone cards produced by adjacent buildings cost 3 less Energy.' };
  }
  return null;
}

export function getBuildingEffectBadge(building: Building): Badge | null {
  const grantedStatusIds = getBuildingGrantedStatusIds(building);
  if (grantedStatusIds.length > 0 && DRONE_STATUS_LIBRARY[grantedStatusIds[0]]) {
    const status = DRONE_STATUS_LIBRARY[grantedStatusIds[0]];
    return { glyph: status.iconGlyph, tooltip: `Effect: ${status.statusName}` };
  }
  if (building.type === 'DATACENTER') {
    return { glyph: '\u26A1', tooltip: 'Effect: +5 Max Energy' };
  }
  if (building.type === 'GEAR_STATION') {
    return { glyph: '\u23E9', tooltip: 'Effect: Overload ability' };
  }
  if (building.type === 'ASSEMBLY_LINE') {
    return { glyph: '\uD83C\uDCCF', tooltip: 'Effect: Draw ability' };
  }
  return null;
}

export function getBuildingAdjacencyIconGlyph(building: Building): Badge | null {
  const badge = getBuildingAdjacencyBadge(building.type);
  if (!badge) {
    return null;
  }
  return {
    glyph: badge.glyph,
    tooltip: badge.tooltip
  };
}

export function getBuildingCardUpgradeIconsHtml(playerId: PlayerId, building: Building): string {
  const icons = [];
  const adjacency = getAdjacencyBonusesForProducedCard(playerId, building.id);
  if (adjacency?.statuses?.length) {
    for (const status of adjacency.statuses) {
      icons.push({ glyph: status.glyph, tooltip: status.tooltip });
    }
  }
  for (const statusId of getBuildingGrantedStatusIds(building)) {
    if (DRONE_STATUS_LIBRARY[statusId]) {
      const status = DRONE_STATUS_LIBRARY[statusId];
      icons.push({ glyph: status.iconGlyph, tooltip: status.description });
    }
  }
  if (icons.length === 0) {
    return '<span class="building-upgrade-empty">\u2014</span>';
  }
  return icons
    .map(
      (item) => `
        <span class="building-upgrade-icon large">
          ${item.glyph}
          <span class="building-upgrade-tooltip">${item.tooltip}</span>
        </span>
      `
    )
    .join('');
}

export function getBuildingAbilityCardsHtml(building: Building, currentPlayer: Player, overloadTargetingActive: boolean): string {
  if (building.type === 'ARMORY') {
    const onCooldown = building.createTankDroneCooldown > 0;
    const disabled = currentPlayer.supply < 15 || onCooldown;
    return `
      <button class="ability-card building-ability-card" data-armory-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Create Tank Drone</span>
        <span class="ability-line">15 SUP \u2022 ${onCooldown ? `CD ${building.createTankDroneCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  if (building.type === 'REPLICATOR') {
    const onCooldown = building.createPawnDroneCooldown > 0;
    const disabled = currentPlayer.supply < 10 || onCooldown;
    return `
      <button class="ability-card building-ability-card" data-replicator-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Create Pawn Drone</span>
        <span class="ability-line">10 SUP \u2022 ${onCooldown ? `CD ${building.createPawnDroneCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  if (building.type === 'WORKSHOP') {
    const onCooldown = building.createSupportDroneCooldown > 0;
    const disabled = currentPlayer.supply < 15 || onCooldown;
    return `
      <button class="ability-card building-ability-card" data-workshop-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Create Support Drone</span>
        <span class="ability-line">15 SUP \u2022 ${onCooldown ? `CD ${building.createSupportDroneCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  if (building.type === 'DATACENTER') {
    const onCooldown = Boolean(building.obtainUsedThisTurn);
    const hasAdjacentWorkshop = isWorkshopAdjacentToDatacenter(currentPlayer.id, building.id);
    const disabled = currentPlayer.energy < 5 || onCooldown;
    const specialistCost = CARD_LIBRARY.SPECIALIST.energyCost;
    const createSpecialistOnCooldown = building.createSpecialistCooldown > 0;
    const createSpecialistDisabled = !building.upgraded || currentPlayer.supply < specialistCost || createSpecialistOnCooldown;
    return `
      <button class="ability-card building-ability-card" data-datacenter-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Obtain</span>
        <span class="ability-line">5 ENG \u2022 +${hasAdjacentWorkshop ? 8 : 5} SUP \u2022 ${onCooldown ? 'Used' : 'Ready'}</span>
      </button>
      <button class="ability-card building-ability-card" data-datacenter-create-id="${building.id}" ${createSpecialistDisabled ? 'disabled' : ''}>
        <span class="ability-name">Create Specialist Drone</span>
        <span class="ability-line">${specialistCost} SUP \u2022 ${!building.upgraded ? 'Need Upgrade' : createSpecialistOnCooldown ? `CD ${building.createSpecialistCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  if (building.type === 'GEAR_STATION') {
    const onCooldown = Boolean(building.overloadUsedThisTurn);
    const disabled = currentPlayer.energy < 5 || onCooldown || overloadTargetingActive;
    const ghostbladeCost = CARD_LIBRARY.CREATE_GHOSTBLADE.energyCost;
    const createGhostbladeOnCooldown = building.createGhostbladeCooldown > 0;
    const createGhostbladeDisabled = !building.upgraded || currentPlayer.supply < ghostbladeCost || createGhostbladeOnCooldown;
    return `
      <button class="ability-card building-ability-card" data-gear-station-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Overload</span>
        <span class="ability-line">5 ENG \u2022 ${overloadTargetingActive ? 'Targeting' : onCooldown ? 'Used' : 'Ready'}</span>
      </button>
      <button class="ability-card building-ability-card" data-gear-station-create-id="${building.id}" ${createGhostbladeDisabled ? 'disabled' : ''}>
        <span class="ability-name">Create Ghostblade</span>
        <span class="ability-line">${ghostbladeCost} SUP \u2022 ${!building.upgraded ? 'Need Upgrade' : createGhostbladeOnCooldown ? `CD ${building.createGhostbladeCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  if (building.type === 'ASSEMBLY_LINE') {
    const disabled = currentPlayer.energy < 2;
    const artilleryCost = CARD_LIBRARY.ARTILLERY.energyCost;
    const createArtilleryOnCooldown = building.createArtilleryCooldown > 0;
    const createArtilleryDisabled = !building.upgraded || currentPlayer.supply < artilleryCost || createArtilleryOnCooldown;
    return `
      <button class="ability-card building-ability-card" data-assembly-line-id="${building.id}" ${disabled ? 'disabled' : ''}>
        <span class="ability-name">Draw</span>
        <span class="ability-line">2 ENG \u2022 ${disabled ? 'Need 2' : 'Ready'}</span>
      </button>
      <button class="ability-card building-ability-card" data-assembly-line-create-id="${building.id}" ${createArtilleryDisabled ? 'disabled' : ''}>
        <span class="ability-name">Create Artillery</span>
        <span class="ability-line">${artilleryCost} SUP \u2022 ${!building.upgraded ? 'Need Upgrade' : createArtilleryOnCooldown ? `CD ${building.createArtilleryCooldown}` : 'Ready'}</span>
      </button>
    `;
  }
  return `<div class="improvement-empty">No abilities.</div>`;
}
