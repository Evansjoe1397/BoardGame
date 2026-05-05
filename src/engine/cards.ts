import type { PlayerId, StatusId, Card, Building, BuildingType, CardId } from '../types';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY, BUILDING_PERK_DRAFT_POOL } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import { shuffle, fromSquareKey } from '../utils.ts';

// ---------------------------------------------------------------------------
// Status instance creation
// ---------------------------------------------------------------------------

interface CreatedStatusInstance {
  key: string;
  statusId: StatusId;
  glyph: string;
  label: string;
  tooltip: string;
}

export function createStatusInstance(statusId: StatusId): CreatedStatusInstance | null {
  const template = DRONE_STATUS_LIBRARY[statusId];
  if (!template) {
    return null;
  }
  return {
    key: `status_${template.id.toLowerCase()}`,
    statusId: template.id,
    glyph: template.iconGlyph,
    label: template.statusName,
    tooltip: template.description
  };
}

// ---------------------------------------------------------------------------
// Building draft perk rolls
// ---------------------------------------------------------------------------

export function rollBuildingDraftStatuses(buildingType: BuildingType, count: number = 3): StatusId[] {
  const pool: StatusId[] = BUILDING_PERK_DRAFT_POOL[buildingType] ?? [];
  return shuffle([...pool]).slice(0, Math.min(count, pool.length));
}

// ---------------------------------------------------------------------------
// Adjacency bonuses
// ---------------------------------------------------------------------------

interface AdjacencyStatus {
  key: string;
  glyph: string;
  label: string;
  tooltip: string;
}

interface AdjacencyBonusResult {
  hpBonus: number;
  attackBonus: number;
  supplyBonusMultiplier: number;
  moveBonus: number;
  energyCostDelta: number;
  statuses: AdjacencyStatus[];
}

export function applyAdjacencyBonusesToCard(playerId: PlayerId, card: Card): void {
  if (!card) {
    return;
  }
  const cardTemplate = CARD_LIBRARY[card.cardId];
  if (!cardTemplate || cardTemplate.cardType !== 'unit_summon') {
    card.adjacencyBonuses = null as unknown as undefined;
    return;
  }
  if (!card.producedByBuildingId) {
    card.adjacencyBonuses = null as unknown as undefined;
    return;
  }
  const player = state.players[playerId];
  const sourceBuilding = player?.buildings?.find((building: Building) => building.id === card.producedByBuildingId) ?? null;
  if (!sourceBuilding) {
    card.adjacencyBonuses = null as unknown as undefined;
    return;
  }
  const cardMatchesFactory =
    (sourceBuilding.type === 'ARMORY' && card.cardId === CARD_LIBRARY.TANK_DRONE.id) ||
    (sourceBuilding.type === 'REPLICATOR' && card.cardId === CARD_LIBRARY.PAWN_DRONE.id) ||
    (sourceBuilding.type === 'WORKSHOP' && card.cardId === CARD_LIBRARY.SUPPORT_DRONE.id) ||
    (sourceBuilding.type === 'DATACENTER' && card.cardId === CARD_LIBRARY.SPECIALIST.id) ||
    (sourceBuilding.type === 'GEAR_STATION' && card.cardId === CARD_LIBRARY.CREATE_GHOSTBLADE.id) ||
    (sourceBuilding.type === 'ASSEMBLY_LINE' && card.cardId === CARD_LIBRARY.ARTILLERY.id);
  if (!cardMatchesFactory) {
    card.adjacencyBonuses = null as unknown as undefined;
    return;
  }
  card.adjacencyBonuses = getAdjacencyBonusesForProducedCard(playerId, card.producedByBuildingId) as Card['adjacencyBonuses'];
}

// ---------------------------------------------------------------------------
// Card energy cost
// ---------------------------------------------------------------------------

export function getCardEnergyCost(card: Card | null | undefined): number {
  if (!card) {
    return 0;
  }
  const template = CARD_LIBRARY[card.cardId];
  if (!template) {
    return 0;
  }
  const delta = (card.adjacencyBonuses as { energyCostDelta?: number })?.energyCostDelta ?? 0;
  return Math.max(0, template.energyCost + delta);
}

// ---------------------------------------------------------------------------
// Refresh adjacency bonuses for all player cards
// ---------------------------------------------------------------------------

export function refreshAdjacencyBonusesForPlayerCards(playerId: PlayerId): void {
  const player = state.players[playerId];
  if (!player) {
    return;
  }
  for (const zone of [player.hand, player.deck, player.discard]) {
    for (const card of zone) {
      applyAdjacencyBonusesToCard(playerId, card);
    }
  }
}

// ---------------------------------------------------------------------------
// Adjacency bonus calculation for a produced card
// ---------------------------------------------------------------------------

export function getAdjacencyBonusesForProducedCard(playerId: PlayerId, sourceBuildingId: string): AdjacencyBonusResult | null {
  const player = state.players[playerId];
  const sourceBuilding = player.buildings.find((building: Building) => building.id === sourceBuildingId);
  if (!sourceBuilding) {
    return null;
  }

  let hpBonus = 0;
  let attackBonus = 0;
  let supplyBonusMultiplier = 0;
  let moveBonus = 0;
  let energyCostDelta = 0;
  const statuses: AdjacencyStatus[] = [];

  for (const building of player.buildings) {
    if (building.id === sourceBuilding.id) {
      continue;
    }
    if (!areBuildingsSideAdjacent(sourceBuilding, building)) {
      continue;
    }

    if (building.type === 'ARMORY') {
      hpBonus += 1;
    } else if (building.type === 'REPLICATOR') {
      attackBonus += 1;
    } else if (building.type === 'WORKSHOP') {
      supplyBonusMultiplier += 0.5;
    } else if (building.type === 'GEAR_STATION') {
      moveBonus += 1;
    } else if (building.type === 'ASSEMBLY_LINE') {
      energyCostDelta -= 3;
    }
  }

  if (hpBonus > 0) {
    statuses.push({
      key: 'adj_armory_hp',
      glyph: '&#10133;',
      label: '+HP',
      tooltip: 'Adjacency bonus from The Armory, +1 HP'
    });
  }
  if (attackBonus > 0) {
    statuses.push({
      key: 'adj_replicator_att',
      glyph: '&#128165;',
      label: '+ATT',
      tooltip: 'Adjacency bonus from The Replicator, +1 ATT'
    });
  }
  if (supplyBonusMultiplier > 0) {
    statuses.push({
      key: 'adj_workshop_supply',
      glyph: '&#36;',
      label: '+Supply',
      tooltip: 'Adjacency bonus from The Workshop, +50% SUP'
    });
  }
  if (moveBonus > 0) {
    statuses.push({
      key: 'adj_gear_station_mov',
      glyph: '&#128736;',
      label: '+MOV',
      tooltip: 'Adjacency bonus from Gear Station, +1 MOV'
    });
  }
  if (energyCostDelta < 0) {
    statuses.push({
      key: 'adj_assembly_line_cost',
      glyph: '&#9881;',
      label: '-ENG',
      tooltip: 'Adjacency bonus from Assembly Line, -3 Energy Cost'
    });
  }

  if (hpBonus === 0 && attackBonus === 0 && supplyBonusMultiplier === 0 && moveBonus === 0 && energyCostDelta === 0) {
    return null;
  }

  return {
    hpBonus,
    attackBonus,
    supplyBonusMultiplier,
    moveBonus,
    energyCostDelta,
    statuses
  };
}

// ---------------------------------------------------------------------------
// Building side-adjacency check
// ---------------------------------------------------------------------------

export function areBuildingsSideAdjacent(buildingA: Building, buildingB: Building): boolean {
  const a = fromSquareKey(buildingA.squareKey);
  const b = fromSquareKey(buildingB.squareKey);
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return dx + dz === 1;
}

// ---------------------------------------------------------------------------
// Retroactive building status upgrade to existing cards
// ---------------------------------------------------------------------------

export function applyBuildingStatusUpgradeToExistingCards(playerId: PlayerId, buildingId: string, statusId: StatusId): void {
  const player = state.players[playerId];
  if (!player || !statusId) {
    return;
  }
  const touchPile = (pile: Card[]): void => {
    for (const card of pile ?? []) {
      if (!card || card.producedByBuildingId !== buildingId) {
        continue;
      }
      if (!card.grantedStatusIds) {
        card.grantedStatusIds = [];
      }
      if (!card.grantedStatusIds.includes(statusId)) {
        card.grantedStatusIds.push(statusId);
      }
      applyAdjacencyBonusesToCard(playerId, card);
    }
  };
  touchPile(player.hand);
  touchPile(player.deck);
  touchPile(player.discard);
  if (player.processEcho) {
    touchPile((Object.values(player.processEcho).filter(Boolean) as Card[]));
  }
}
