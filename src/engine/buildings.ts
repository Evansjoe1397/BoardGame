import type { PlayerId, Building, BuildingType, Unit, Player, Card, StatusId, CardId } from '../types';
import { BUILDING_UPGRADE_SUPPLY_COST, COMPANY_NAMES, BASE_MAX_HIT_POINTS } from '../constants.ts';
import { BUILD_CARD_LIBRARY, CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY, BUILDING_PERK_DRAFT_POOL } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import {
  shuffle,
  fromSquareKey,
  getCurrentPlayer,
  getUnitById,
  getUnitAt,
  getBuildingAtSquare,
  getBuildingById,
  getBuildingSupplyCostByType,
  isPlayerBaseSquare,
  clearSelection,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import { renderUI, syncBoardVisualState, addLog, emit } from '../shared/events.ts';
import {
  getUnitCurrentMoveRange,
  isUnitPlanted,
  isUnitMovementStunned,
  unitHasStatus,
  hasBeaconCoreMagnet,
  getWorkshopRepairStatusIdsForPlayer
} from './unitStats.ts';
import {
  applyAdjacencyBonusesToCard,
  getCardEnergyCost,
  refreshAdjacencyBonusesForPlayerCards,
  getAdjacencyBonusesForProducedCard,
  areBuildingsSideAdjacent,
  applyBuildingStatusUpgradeToExistingCards,
  createStatusInstance,
  rollBuildingDraftStatuses
} from './cards.ts';
import { setEnergy, setSupply } from './playerResources.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBuildingBaseName(buildingType: BuildingType | string): string {
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

export function getBuildingGrantedStatusIds(building: Building): StatusId[] {
  if (!building) {
    return [];
  }
  const ids = new Set<StatusId>();
  if (building.assignedStatusId) {
    ids.add(building.assignedStatusId);
  }
  for (const statusId of building.upgradeStatusIds ?? []) {
    ids.add(statusId);
  }
  return [...ids];
}

export function canBuildingBeUpgraded(building: Building): boolean {
  if (!building) {
    return false;
  }
  return (
    building.type === 'ARMORY' ||
    building.type === 'REPLICATOR' ||
    building.type === 'WORKSHOP' ||
    building.type === 'DATACENTER' ||
    building.type === 'GEAR_STATION' ||
    building.type === 'ASSEMBLY_LINE'
  );
}

export function getBuildingUpgradeSupplyCost(building: Building): number {
  if (!building) {
    return BUILDING_UPGRADE_SUPPLY_COST;
  }
  if (building.type === 'ARMORY' || building.type === 'REPLICATOR' || building.type === 'WORKSHOP') {
    return 65;
  }
  return BUILDING_UPGRADE_SUPPLY_COST;
}

interface BadgeInfo {
  glyph: string;
  tooltip: string;
}

export function getBuildingAdjacencyBadge(buildingType: BuildingType | string): BadgeInfo | null {
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

export function getBuildingEffectBadge(building: Building): BadgeInfo | null {
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

export function getBuildingAdjacencyIconGlyph(building: Building): BadgeInfo | null {
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
  const icons: BadgeInfo[] = [];
  const adjacency = getAdjacencyBonusesForProducedCard(playerId, building.id);
  if (adjacency?.statuses) {
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
      (item: BadgeInfo) => `
        <span class="building-upgrade-icon large">
          ${item.glyph}
          <span class="building-upgrade-tooltip">${item.tooltip}</span>
        </span>
      `
    )
    .join('');
}

function isWorkshopAdjacentToDatacenter(playerId: PlayerId, datacenterBuildingId: string): boolean {
  const player = state.players[playerId];
  const datacenter = player.buildings.find((building: Building) => building.id === datacenterBuildingId && building.type === 'DATACENTER');
  if (!datacenter) {
    return false;
  }
  return player.buildings.some(
    (building: Building) => building.type === 'WORKSHOP' && areBuildingsSideAdjacent(datacenter, building)
  );
}

function getOverloadBaseMoveForUnit(unit: Unit | null | undefined): number {
  if (!unit) {
    return 0;
  }
  const current = getUnitCurrentMoveRange(unit);
  return Math.max(0, current - (unit.overloadBonusMovementThisTurn ?? 0));
}

export function canTargetUnitWithOverload(unit: Unit | null | undefined): boolean {
  if (!unit || unit.owner !== state.currentPlayerId) {
    return false;
  }
  if (!canPlayerDirectlyTargetUnit(state.currentPlayerId, unit)) {
    return false;
  }
  if (unit.hasMoved && unit.hasAttacked) {
    return false;
  }
  const canMoveAfterAttack = (unit.tacticalDashActiveThisTurn ?? false) || (unit.systemShockFollowUpReady ?? false);
  if (unit.hasAttacked && !canMoveAfterAttack) {
    return false;
  }
  if (isUnitMovementStunned(unit)) {
    return false;
  }
  if (isUnitPlanted(unit) && !hasBeaconCoreMagnet(unit)) {
    return false;
  }
  const baseMoveGain = getOverloadBaseMoveForUnit(unit);
  return baseMoveGain > 0;
}

function createProducedDroneCardFromBuilding(playerId: PlayerId, building: Building, cardId: CardId): Card {
  const producedAt = getBuildingDisplayName(building);
  const grantedStatusIds = new Set<StatusId>();
  for (const statusId of getBuildingGrantedStatusIds(building)) {
    grantedStatusIds.add(statusId);
  }
  if (building.type === 'DATACENTER' && cardId === CARD_LIBRARY.SPECIALIST.id) {
    const repairStatusIds = getWorkshopRepairStatusIdsForPlayer(playerId);
    for (const statusId of repairStatusIds) {
      grantedStatusIds.add(statusId);
    }
  }
  const createdCard: Card = {
    cardId,
    producedAt,
    producedByBuildingId: building.id,
    grantedStatusIds: [...grantedStatusIds]
  };
  applyAdjacencyBonusesToCard(playerId, createdCard);
  return createdCard;
}

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

export function activateFoundationTargeting(): void {
  const currentPlayer = getCurrentPlayer();
  if (currentPlayer.supply < BUILD_CARD_LIBRARY.FOUNDATION.supplyCost) {
    addLog('Not enough Supply to play Foundation.');
    return;
  }
  if ((currentPlayer.buildings ?? []).length === 0) {
    addLog('No buildings available to destroy with Foundation.');
    return;
  }
  state.mode = 'foundation_targeting' as typeof state.mode;
  state.pendingFoundationTargetBuildingId = null;
  state.selectedCardHandIndex = null;
  state.selectedUnitId = null;
  state.placingBuildingType = null;
  addLog('Foundation: select one of your buildings to destroy.');
  syncBoardVisualState();
  renderUI();
}

export function executeFoundationConfirm(targetBuildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const targetBuilding = getBuildingById(currentPlayer.id, targetBuildingId);
  if (!targetBuilding) {
    addLog('Selected building is no longer available.');
    clearSelection();
    renderUI();
    return;
  }
  const foundationCost = BUILD_CARD_LIBRARY.FOUNDATION.supplyCost;
  if (currentPlayer.supply < foundationCost) {
    addLog('Not enough Supply to play Foundation.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - foundationCost);

  // 1) Remove all building abilities by removing the building from player's building list.
  currentPlayer.buildings = currentPlayer.buildings.filter((building: Building) => building.id !== targetBuilding.id);
  emit({ type: 'BUILDING_DESTROYED', buildingId: targetBuilding.id });
  // 2) Remove adjacency bonuses provided by destroyed building to adjacent building drone cards.
  refreshAdjacencyBonusesForPlayerCards(currentPlayer.id);
  // Keep other derived caps in sync after building removal (e.g., Datacenter bonus).
  refreshPlayerMaxEnergy(currentPlayer.id, true);
  // 3/4) Visual removal and square vacancy are driven by absence in player.buildings.
  // 5) Add 5 to player's maximum base HP.
  currentPlayer.baseMaxHitPoints = Math.max(1, (currentPlayer.baseMaxHitPoints ?? BASE_MAX_HIT_POINTS) + 5);
  // 6) Add 5 to current base HP.
  currentPlayer.baseHitPoints = Math.min(currentPlayer.baseMaxHitPoints, currentPlayer.baseHitPoints + 5);
  // 7) Refund 50% of destroyed building supply cost.
  const destroyedSupplyCost = getBuildingSupplyCostByType(targetBuilding.type as BuildingType);
  const refund = Math.floor(destroyedSupplyCost * 0.5);
  setSupply(currentPlayer, currentPlayer.supply + refund);

  addLog(
    `Foundation destroyed ${getBuildingDisplayName(targetBuilding)}. Refunded ${refund} Supply and increased Player ${currentPlayer.id} base HP cap by 5.`
  );

  clearSelection();
  syncBoardVisualState();
  renderUI();
}

/**
 * Backwards-compat wrapper: reads pendingFoundationTargetBuildingId out of
 * state and delegates. Used by call sites that haven't been migrated to
 * the FOUNDATION_CONFIRM action yet.
 */
export function confirmFoundationUse(): void {
  const targetBuildingId = state.pendingFoundationTargetBuildingId;
  if (!targetBuildingId) {
    addLog('Selected building is no longer available.');
    clearSelection();
    renderUI();
    return;
  }
  executeFoundationConfirm(targetBuildingId);
}

// ---------------------------------------------------------------------------
// Create building
// ---------------------------------------------------------------------------

interface BuildingOptions {
  assignedStatusId?: StatusId | null;
}

export function createBuilding(owner: PlayerId, buildingType: BuildingType | string, squareKey: string, options: BuildingOptions = {}): Building {
  const player = state.players[owner];
  const companyName = getRandomCompanyName();
  const baseName = getBuildingBaseName(buildingType);
  const building: Building = {
    id: `b_${owner}_${buildingType}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    owner,
    type: buildingType as BuildingType,
    squareKey,
    companyName,
    displayName: `${baseName} ${companyName}`,
    assignedStatusId: options.assignedStatusId ?? null,
    upgradeStatusIds: [],
    upgraded: false,
    createTankDroneCooldown: 0,
    createPawnDroneCooldown: 0,
    createSupportDroneCooldown: 0,
    createSpecialistCooldown: 0,
    createGhostbladeCooldown: 0,
    createArtilleryCooldown: 0,
    obtainUsedThisTurn: false,
    overloadUsedThisTurn: false
  };

  player.buildings.push(building);
  emit({ type: 'BUILDING_PLACED', building });
  refreshAdjacencyBonusesForPlayerCards(owner);
  refreshPlayerMaxEnergy(owner, true);
  return building;
}

// ---------------------------------------------------------------------------
// Building production
// ---------------------------------------------------------------------------

export function activateArmoryProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'ARMORY') {
    return;
  }

  if (building.createTankDroneCooldown > 0) {
    addLog('Create Tank Drone is on cooldown.');
    return;
  }

  const supplyCost = 15;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create a Tank Drone card.');
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const producedAt = getBuildingDisplayName(building);
  const grantedStatusIds = getBuildingGrantedStatusIds(building);
  const createdCard: Card = {
    cardId: CARD_LIBRARY.TANK_DRONE.id,
    producedAt,
    producedByBuildingId: building.id,
    grantedStatusIds
  };
  applyAdjacencyBonusesToCard(currentPlayer.id, createdCard);
  currentPlayer.deck.push(createdCard);
  building.createTankDroneCooldown = 1;
  addLog(
    `Player ${currentPlayer.id} used ${producedAt} and added Tank Drone to deck.`
  );
  renderUI();
}

export function activateReplicatorProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'REPLICATOR') {
    return;
  }

  if (building.createPawnDroneCooldown > 0) {
    addLog('Create Pawn Drone is on cooldown.');
    return;
  }

  const supplyCost = 10;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create a Pawn Drone card.');
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const producedAt = getBuildingDisplayName(building);
  const grantedStatusIds = getBuildingGrantedStatusIds(building);
  const createdCard: Card = {
    cardId: CARD_LIBRARY.PAWN_DRONE.id,
    producedAt,
    producedByBuildingId: building.id,
    grantedStatusIds
  };
  applyAdjacencyBonusesToCard(currentPlayer.id, createdCard);
  currentPlayer.deck.push(createdCard);
  building.createPawnDroneCooldown = 1;
  addLog(
    `Player ${currentPlayer.id} used ${producedAt} and added Pawn Drone to deck.`
  );
  renderUI();
}

export function activateWorkshopProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'WORKSHOP') {
    return;
  }

  if (building.createSupportDroneCooldown > 0) {
    addLog('Create Support Drone is on cooldown.');
    return;
  }

  const supplyCost = 15;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create a Support Drone card.');
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const producedAt = getBuildingDisplayName(building);
  const grantedStatusIds = getBuildingGrantedStatusIds(building);
  const createdCard: Card = {
    cardId: CARD_LIBRARY.SUPPORT_DRONE.id,
    producedAt,
    producedByBuildingId: building.id,
    grantedStatusIds
  };
  applyAdjacencyBonusesToCard(currentPlayer.id, createdCard);
  currentPlayer.deck.push(createdCard);
  building.createSupportDroneCooldown = 1;
  addLog(
    `Player ${currentPlayer.id} used ${producedAt} and added Support Drone to deck.`
  );
  renderUI();
}

export function activateDatacenterObtain(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'DATACENTER') {
    return;
  }
  if (building.obtainUsedThisTurn) {
    addLog('Obtain can be used only once per turn.');
    return;
  }
  const energyCost = 5;
  if (currentPlayer.energy < energyCost) {
    addLog('Not enough Energy to use Obtain.');
    return;
  }

  setEnergy(currentPlayer, currentPlayer.energy - energyCost);
  building.obtainUsedThisTurn = true;
  const hasAdjacentWorkshop = isWorkshopAdjacentToDatacenter(currentPlayer.id, building.id);
  const gainedSupply = hasAdjacentWorkshop ? 8 : 5;
  setSupply(currentPlayer, currentPlayer.supply + gainedSupply);
  addLog(
    `Player ${currentPlayer.id} used Obtain (${getBuildingDisplayName(building)}) and gained ${gainedSupply} Supply.`
  );
  renderUI();
}

export function activateDatacenterProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'DATACENTER') {
    return;
  }
  if (!building.upgraded) {
    addLog('Upgrade Datacenter first to unlock Specialist production.');
    return;
  }
  if (building.createSpecialistCooldown > 0) {
    addLog('Create Specialist Drone is on cooldown.');
    return;
  }
  const supplyCost = CARD_LIBRARY.SPECIALIST.energyCost;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create a Specialist card.');
    return;
  }
  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const createdCard = createProducedDroneCardFromBuilding(currentPlayer.id, building, CARD_LIBRARY.SPECIALIST.id);
  currentPlayer.deck.push(createdCard);
  building.createSpecialistCooldown = 1;
  addLog(`Player ${currentPlayer.id} used ${getBuildingDisplayName(building)} and added Specialist to deck.`);
  renderUI();
}

export function activateGearStationOverload(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'GEAR_STATION') {
    return;
  }
  if (building.overloadUsedThisTurn) {
    addLog('Overload can be used only once per turn.');
    return;
  }
  if (currentPlayer.energy < 5) {
    addLog('Not enough Energy to use Overload.');
    return;
  }
  state.mode = 'overload_targeting';
  state.overloadTargetingBuildingId = building.id;
  state.hoverSquareKey = null;
  addLog('Select a friendly drone to apply Overload.');
  syncBoardVisualState();
  renderUI();
}

export function activateGearStationProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'GEAR_STATION') {
    return;
  }
  if (!building.upgraded) {
    addLog('Upgrade Gear Station first to unlock Ghostblade production.');
    return;
  }
  if (building.createGhostbladeCooldown > 0) {
    addLog('Create Ghostblade is on cooldown.');
    return;
  }
  const supplyCost = CARD_LIBRARY.CREATE_GHOSTBLADE.energyCost;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create a Ghostblade card.');
    return;
  }
  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const createdCard = createProducedDroneCardFromBuilding(currentPlayer.id, building, CARD_LIBRARY.CREATE_GHOSTBLADE.id);
  currentPlayer.deck.push(createdCard);
  building.createGhostbladeCooldown = 1;
  addLog(`Player ${currentPlayer.id} used ${getBuildingDisplayName(building)} and added Ghostblade to deck.`);
  renderUI();
}

export function activateAssemblyLineDraw(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'ASSEMBLY_LINE') {
    return;
  }
  const energyCost = 2;
  if (currentPlayer.energy < energyCost) {
    addLog('Not enough Energy to use Draw.');
    return;
  }
  if (currentPlayer.deck.length === 0 && currentPlayer.discard.length === 0) {
    addLog('No cards available to draw.');
    return;
  }
  setEnergy(currentPlayer, currentPlayer.energy - energyCost);
  drawCards(currentPlayer, 1);
  addLog(`Player ${currentPlayer.id} used Draw (${getBuildingDisplayName(building)}) and drew 1 card.`);
  renderUI();
}

export function activateAssemblyLineProduction(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'ASSEMBLY_LINE') {
    return;
  }
  if (!building.upgraded) {
    addLog('Upgrade Assembly Line first to unlock Artillery production.');
    return;
  }
  if (building.createArtilleryCooldown > 0) {
    addLog('Create Artillery is on cooldown.');
    return;
  }
  const supplyCost = CARD_LIBRARY.ARTILLERY.energyCost;
  if (currentPlayer.supply < supplyCost) {
    addLog('Not enough Supply to create an Artillery card.');
    return;
  }
  setSupply(currentPlayer, currentPlayer.supply - supplyCost);
  const createdCard = createProducedDroneCardFromBuilding(currentPlayer.id, building, CARD_LIBRARY.ARTILLERY.id);
  currentPlayer.deck.push(createdCard);
  building.createArtilleryCooldown = 1;
  addLog(`Player ${currentPlayer.id} used ${getBuildingDisplayName(building)} and added Artillery to deck.`);
  renderUI();
}

// ---------------------------------------------------------------------------
// Building upgrade system
// ---------------------------------------------------------------------------

export function activateBuildingUpgrade(buildingId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || !canBuildingBeUpgraded(building)) {
    return;
  }
  if (building.upgraded) {
    addLog(`${getBuildingDisplayName(building)} is already upgraded.`);
    return;
  }
  const upgradeCost = getBuildingUpgradeSupplyCost(building);
  if (currentPlayer.supply < upgradeCost) {
    addLog('Not enough Supply to upgrade this building.');
    return;
  }
  const supportsStatusUpgradeChoice =
    building.type === 'ARMORY' || building.type === 'REPLICATOR' || building.type === 'WORKSHOP';
  if (supportsStatusUpgradeChoice) {
    const alreadyGranted = new Set(getBuildingGrantedStatusIds(building));
    const options = (BUILDING_PERK_DRAFT_POOL[building.type] ?? []).filter((statusId: StatusId) => !alreadyGranted.has(statusId)).slice(0, 8);
    if (options.length === 0) {
      setSupply(currentPlayer, currentPlayer.supply - upgradeCost);
      building.upgraded = true;
      emit({
        type: 'BUILDING_UPGRADED',
        buildingId: building.id,
        upgradeStatusIds: building.upgradeStatusIds ?? [],
        upgraded: true,
      });
      addLog(`Player ${currentPlayer.id} upgraded ${getBuildingDisplayName(building)} for ${upgradeCost} Supply.`);
      renderUI();
      return;
    }
    state.mode = 'building_upgrade_status_pick';
    state.pendingUpgradeBuildingId = building.id;
    state.pendingUpgradeStatusId = null;
    state.pendingUpgradeStatusOptions = options;
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - upgradeCost);
  building.upgraded = true;
  emit({
    type: 'BUILDING_UPGRADED',
    buildingId: building.id,
    upgradeStatusIds: building.upgradeStatusIds ?? [],
    upgraded: true,
  });
  addLog(`Player ${currentPlayer.id} upgraded ${getBuildingDisplayName(building)} for ${upgradeCost} Supply.`);
  renderUI();
}

export function executeConfirmBuildingUpgrade(buildingId: string, selectedStatusId: StatusId): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building) {
    clearSelection();
    renderUI();
    return;
  }
  if (building.upgraded) {
    clearSelection();
    renderUI();
    return;
  }
  const upgradeCost = getBuildingUpgradeSupplyCost(building);
  if (currentPlayer.supply < upgradeCost) {
    addLog('Not enough Supply to upgrade this building.');
    clearSelection();
    renderUI();
    return;
  }
  const allowedOptions = new Set(state.pendingUpgradeStatusOptions ?? []);
  if (!allowedOptions.has(selectedStatusId)) {
    addLog('Selected upgrade status is not valid.');
    return;
  }
  setSupply(currentPlayer, currentPlayer.supply - upgradeCost);
  building.upgraded = true;
  if (!building.upgradeStatusIds) {
    building.upgradeStatusIds = [];
  }
  if (!building.upgradeStatusIds.includes(selectedStatusId)) {
    building.upgradeStatusIds.push(selectedStatusId);
    applyBuildingStatusUpgradeToExistingCards(currentPlayer.id, building.id, selectedStatusId);
  }
  emit({
    type: 'BUILDING_UPGRADED',
    buildingId: building.id,
    upgradeStatusIds: building.upgradeStatusIds,
    upgraded: true,
  });
  refreshAdjacencyBonusesForPlayerCards(currentPlayer.id);
  addLog(
    `Player ${currentPlayer.id} upgraded ${getBuildingDisplayName(building)} for ${upgradeCost} Supply and added ${DRONE_STATUS_LIBRARY[selectedStatusId]?.statusName ?? selectedStatusId}.`
  );
  state.mode = 'idle';
  state.pendingUpgradeBuildingId = null;
  state.pendingUpgradeStatusId = null;
  state.pendingUpgradeStatusOptions = [];
  renderUI();
}

/**
 * Backwards-compat wrapper: reads pendingUpgradeBuildingId / pendingUpgradeStatusId
 * out of state and calls the parameterised entry point. Used by code paths
 * that haven't yet been migrated to dispatch a self-contained action.
 */
export function confirmBuildingUpgradeStatusSelection(): void {
  const buildingId = state.pendingUpgradeBuildingId;
  const selectedStatusId = state.pendingUpgradeStatusId;
  if (!buildingId || !selectedStatusId) return;
  executeConfirmBuildingUpgrade(buildingId, selectedStatusId);
}

// ---------------------------------------------------------------------------
// Building placement confirmations
// ---------------------------------------------------------------------------

export function confirmArmoryBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingArmorySquareKey;
  const statusId = state.pendingArmoryStatusId;
  const armoryCard = BUILD_CARD_LIBRARY.ARMORY;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming The Armory build.');
    return;
  }

  if (currentPlayer.supply < armoryCard.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }

  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }

  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - armoryCard.supplyCost);
  const building = createBuilding(currentPlayer.id, armoryCard.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingArmoryDraftStatusIds = [];
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function confirmReplicatorBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingReplicatorSquareKey;
  const statusId = state.pendingReplicatorStatusId;
  const replicatorCard = BUILD_CARD_LIBRARY.REPLICATOR;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming The Replicator build.');
    return;
  }

  if (currentPlayer.supply < replicatorCard.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }

  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }

  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - replicatorCard.supplyCost);
  const building = createBuilding(currentPlayer.id, replicatorCard.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingArmoryDraftStatusIds = [];
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  state.pendingWorkshopSquareKey = null;
  state.pendingWorkshopStatusId = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function confirmWorkshopBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingWorkshopSquareKey;
  const statusId = state.pendingWorkshopStatusId;
  const workshopCard = BUILD_CARD_LIBRARY.WORKSHOP;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming The Workshop build.');
    return;
  }

  if (currentPlayer.supply < workshopCard.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }

  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }

  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - workshopCard.supplyCost);
  const building = createBuilding(currentPlayer.id, workshopCard.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingArmoryDraftStatusIds = [];
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  state.pendingWorkshopSquareKey = null;
  state.pendingWorkshopStatusId = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function confirmDatacenterBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingDatacenterSquareKey;
  const statusId = state.pendingDatacenterStatusId;
  const datacenterCard = BUILD_CARD_LIBRARY.DATACENTER;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming Datacenter build.');
    return;
  }
  if (currentPlayer.supply < datacenterCard.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }
  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - datacenterCard.supplyCost);
  const building = createBuilding(currentPlayer.id, datacenterCard.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingDatacenterSquareKey = null;
  state.pendingDatacenterStatusId = null;
  addLog(`Datacenter built: Player ${currentPlayer.id} max Energy increased by 5 (now ${getPlayerMaxEnergy(currentPlayer)}).`);
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function confirmGearStationBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingGearStationSquareKey;
  const statusId = state.pendingGearStationStatusId;
  const card = BUILD_CARD_LIBRARY.GEAR_STATION;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming Gear Station build.');
    return;
  }
  if (currentPlayer.supply < card.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }
  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - card.supplyCost);
  const building = createBuilding(currentPlayer.id, card.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingGearStationSquareKey = null;
  state.pendingGearStationStatusId = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function confirmAssemblyLineBuildPlacement(): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = state.pendingAssemblyLineSquareKey;
  const statusId = state.pendingAssemblyLineStatusId;
  const card = BUILD_CARD_LIBRARY.ASSEMBLY_LINE;

  if (!squareKey || !statusId || !DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming Assembly Line build.');
    return;
  }
  if (currentPlayer.supply < card.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }
  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - card.supplyCost);
  const building = createBuilding(currentPlayer.id, card.buildingType, squareKey, {
    assignedStatusId: statusId
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingAssemblyLineSquareKey = null;
  state.pendingAssemblyLineStatusId = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Unified building activation — routes by building.type + ability slot.
// Single entry point for the ACTIVATE_BUILDING action.
// ---------------------------------------------------------------------------

export type BuildingAbility = 'production' | 'overload' | 'obtain' | 'draw' | 'upgrade';

export function executeActivateBuilding(buildingId: string, ability: BuildingAbility): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((b: Building) => b.id === buildingId);
  if (!building) {
    addLog('Building not found.');
    return;
  }

  if (ability === 'upgrade') {
    activateBuildingUpgrade(buildingId);
    return;
  }
  if (ability === 'overload') {
    if (building.type !== 'GEAR_STATION') return;
    activateGearStationOverload(buildingId);
    return;
  }
  if (ability === 'obtain') {
    if (building.type !== 'DATACENTER') return;
    activateDatacenterObtain(buildingId);
    return;
  }
  if (ability === 'draw') {
    if (building.type !== 'ASSEMBLY_LINE') return;
    activateAssemblyLineDraw(buildingId);
    return;
  }
  if (ability === 'production') {
    switch (building.type) {
      case 'ARMORY': activateArmoryProduction(buildingId); return;
      case 'REPLICATOR': activateReplicatorProduction(buildingId); return;
      case 'WORKSHOP': activateWorkshopProduction(buildingId); return;
      case 'DATACENTER': activateDatacenterProduction(buildingId); return;
      case 'GEAR_STATION': activateGearStationProduction(buildingId); return;
      case 'ASSEMBLY_LINE': activateAssemblyLineProduction(buildingId); return;
    }
  }
}

// ---------------------------------------------------------------------------
// Unified placement: handles all six status-pick buildings (Armory,
// Replicator, Workshop, Datacenter, Gear Station, Assembly Line). The
// per-building confirmXBuildPlacement functions remain for now as thin
// wrappers but the reducer routes through this single entry point.
// ---------------------------------------------------------------------------

const BUILD_CARD_BY_TYPE: Record<string, { id: BuildingType; supplyCost: number; buildingType: BuildingType } | undefined> = {
  ARMORY: BUILD_CARD_LIBRARY.ARMORY,
  REPLICATOR: BUILD_CARD_LIBRARY.REPLICATOR,
  WORKSHOP: BUILD_CARD_LIBRARY.WORKSHOP,
  DATACENTER: BUILD_CARD_LIBRARY.DATACENTER,
  GEAR_STATION: BUILD_CARD_LIBRARY.GEAR_STATION,
  ASSEMBLY_LINE: BUILD_CARD_LIBRARY.ASSEMBLY_LINE,
  FOUNDATION: BUILD_CARD_LIBRARY.FOUNDATION,
};

function clearAllPendingBuildState(): void {
  state.mode = 'idle';
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingArmoryDraftStatusIds = [];
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  state.pendingWorkshopSquareKey = null;
  state.pendingWorkshopStatusId = null;
  state.pendingDatacenterSquareKey = null;
  state.pendingDatacenterStatusId = null;
  state.pendingGearStationSquareKey = null;
  state.pendingGearStationStatusId = null;
  state.pendingAssemblyLineSquareKey = null;
  state.pendingAssemblyLineStatusId = null;
}

export function executeConfirmBuildingPlacement(
  buildingType: BuildingType,
  squareKey: string,
  statusId: StatusId,
): void {
  const card = BUILD_CARD_BY_TYPE[buildingType];
  if (!card) {
    addLog(`Unknown building type: ${buildingType}.`);
    return;
  }
  if (!DRONE_STATUS_LIBRARY[statusId]) {
    addLog('Select a Drone Status before confirming the build.');
    return;
  }

  const currentPlayer = getCurrentPlayer();
  if (currentPlayer.supply < card.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    clearSelection();
    renderUI();
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, squareKey)) {
    addLog('Building can only be placed on your base squares.');
    clearSelection();
    renderUI();
    return;
  }
  const square = fromSquareKey(squareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, squareKey)) {
    addLog('Selected base square is no longer available.');
    clearSelection();
    renderUI();
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - card.supplyCost);
  const building = createBuilding(currentPlayer.id, card.buildingType, squareKey, {
    assignedStatusId: statusId,
  });
  currentPlayer.buildingsPlayedThisTurn += 1;
  clearAllPendingBuildState();
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${squareKey}.`);
  syncBoardVisualState();
  renderUI();
}

// Direct-place (no status pick) — currently only Foundation, but parametrised
// in case more zero-status buildings appear.
export function executePlayBuildCard(buildingType: BuildingType, targetSquareKey: string): void {
  const card = BUILD_CARD_BY_TYPE[buildingType];
  if (!card) {
    addLog(`Unknown building type: ${buildingType}.`);
    return;
  }
  const currentPlayer = getCurrentPlayer();
  if (currentPlayer.supply < card.supplyCost) {
    addLog('Not enough Supply to build this structure.');
    return;
  }
  if (!isPlayerBaseSquare(currentPlayer.id, targetSquareKey)) {
    addLog('Building can only be placed on your base squares.');
    return;
  }
  const square = fromSquareKey(targetSquareKey);
  if (getUnitAt(square.x, square.z) || getBuildingAtSquare(currentPlayer.id, targetSquareKey)) {
    addLog('Selected base square is no longer available.');
    return;
  }

  setSupply(currentPlayer, currentPlayer.supply - card.supplyCost);
  const building = createBuilding(currentPlayer.id, card.buildingType, targetSquareKey);
  currentPlayer.buildingsPlayedThisTurn += 1;
  state.mode = 'idle';
  state.placingBuildingType = null;
  addLog(`Player ${currentPlayer.id} built ${getBuildingDisplayName(building)} on ${targetSquareKey}.`);
  syncBoardVisualState();
  renderUI();
}

export function executeCancelBuildingPlacement(): void {
  clearAllPendingBuildState();
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Overload target handler
// ---------------------------------------------------------------------------

interface HitUserData {
  userData: {
    type?: string;
    unitId?: string;
    squareKey?: string;
  };
}

/**
 * State-mutation core for the Overload target. Validates building +
 * target, spends energy, applies the movement bonus. Called from both
 * the legacy handler (handleOverloadTargetClick) and the reducer's
 * GEAR_STATION_OVERLOAD_TARGET case.
 */
export function executeGearStationOverloadTarget(buildingId: string, targetUnitId: string): void {
  const currentPlayer = getCurrentPlayer();
  const building = currentPlayer.buildings.find((candidate: Building) => candidate.id === buildingId);
  if (!building || building.type !== 'GEAR_STATION') {
    clearSelection();
    renderUI();
    return;
  }
  const target = getUnitById(targetUnitId);
  if (!canTargetUnitWithOverload(target)) {
    addLog('This drone is not a valid Overload target.');
    return;
  }
  if (building.overloadUsedThisTurn) {
    addLog('Overload can be used only once per turn.');
    clearSelection();
    renderUI();
    return;
  }
  if (currentPlayer.energy < 5) {
    addLog('Not enough Energy to use Overload.');
    clearSelection();
    renderUI();
    return;
  }
  const movementGain = getOverloadBaseMoveForUnit(target);
  if (movementGain <= 0) {
    addLog('This drone cannot receive movement from Overload.');
    return;
  }

  setEnergy(currentPlayer, currentPlayer.energy - 5);
  building.overloadUsedThisTurn = true;
  target!.overloadBonusMovementThisTurn = (target!.overloadBonusMovementThisTurn ?? 0) + movementGain;
  addLog(
    `Player ${currentPlayer.id} used Overload (${getBuildingDisplayName(building)}) on ${target!.unitName}: +${movementGain} Movement this turn.`,
  );
  state.mode = 'idle';
  state.overloadTargetingBuildingId = null;
  syncBoardVisualState();
  renderUI();
}

export function handleOverloadTargetClick(hit: HitUserData): void {
  const buildingId = state.overloadTargetingBuildingId;
  if (!buildingId) {
    clearSelection();
    renderUI();
    return;
  }
  if (hit.userData.type !== 'unit') {
    addLog('Select a friendly drone target for Overload.');
    return;
  }
  // Input layer hands the validated targetUnitId to the engine.
  const targetId = hit.userData.unitId;
  if (!targetId) return;
  executeGearStationOverloadTarget(buildingId, targetId);
}

// ---------------------------------------------------------------------------
// Foundation target click handler
// ---------------------------------------------------------------------------

export function handleFoundationTargetClick(hit: HitUserData): void {
  const currentPlayer = getCurrentPlayer();
  const squareKey = hit.userData.squareKey;
  if (!squareKey) {
    addLog('Select a building on your base.');
    return;
  }
  const targetBuilding = getBuildingAtSquare(currentPlayer.id, squareKey);
  if (!targetBuilding) {
    addLog('Select one of your existing buildings to destroy.');
    return;
  }
  state.pendingFoundationTargetBuildingId = targetBuilding.id;
  state.mode = 'foundation_confirm' as typeof state.mode;
  renderUI();
}

// ---------------------------------------------------------------------------
// Building ability cards HTML (UI helper)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerBuildingDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface BuildingDeps {
  drawCards?: (player: Player, count: number) => void;
  refreshPlayerMaxEnergy?: (playerId: PlayerId, sync?: boolean) => number;
  getPlayerMaxEnergy?: (player: Player) => number;
}

let drawCards: (player: Player, count: number) => void = () => {};
let refreshPlayerMaxEnergy: (playerId: PlayerId, sync?: boolean) => number = () => 0;
let getPlayerMaxEnergy: (player: Player) => number = () => 0;

export function registerBuildingDeps(deps: BuildingDeps): void {
  if (deps.drawCards) drawCards = deps.drawCards;
  if (deps.refreshPlayerMaxEnergy) refreshPlayerMaxEnergy = deps.refreshPlayerMaxEnergy;
  if (deps.getPlayerMaxEnergy) getPlayerMaxEnergy = deps.getPlayerMaxEnergy;
}
