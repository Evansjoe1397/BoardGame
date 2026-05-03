import { state, createEmptyProcessEcho } from '../state.ts';
import {
  MAX_ENERGY,
  BASE_MAX_HIT_POINTS,
  DAMAGE_TYPES,
} from '../constants.ts';
import type { Player, PlayerId, Card, Unit, StatusId, ProcessEchoSlot } from '../types';
import { CARD_LIBRARY, BUILD_CARD_LIBRARY } from '../data/cardLibrary.ts';
import { UNIT_LIBRARY } from '../data/unitLibrary.ts';
import { DRONE_STATUS_LIBRARY, BUILDING_PERK_DRAFT_POOL } from '../data/statusLibrary.ts';
import {
  toSquareKey,
  getCurrentPlayer,
  getSelectedUnit,
  getBuildingById,
  clearSelection,
} from '../utils.ts';
import {
  handEl,
  pileAEl,
  pileBEl,
  turnStatusEl,
  overlayEl,
  droneStatsLeftEl,
  droneStatsRightEl,
  endTurnBtn,
} from './domSetup.ts';
import {
  getBuildingDisplayName,
  getBuildingAdjacencyIconGlyph,
  getBuildingCardUpgradeIconsHtml,
  getBuildingAbilityCardsHtml,
} from './uiHelpers.ts';
import { logHint } from './log.ts';
import {
  getUnitCurrentMoveRange,
  getUnitCurrentAttackRange,
  getUnitCurrentAttackDamage,
  isUnitPlanted,
  isUnitMovementStunned,
  unitHasStatus,
  hasBeaconCoreMagnet,
  canUnitAttackAfterMoving,
  hasSalvoEmpStatus,
  normalizeEnergizeSystemDamage,
  getTankFaceEaterAttackCooldown,
  casterHasRepairAbility,
  getSpecialistEmpCooldownTurns,
} from '../engine/unitStats.ts';
import { getCardEnergyCost } from '../engine/cards.ts';
import { setEnergy, setMaxEnergy } from '../engine/playerResources.ts';
import {
  canBuildingBeUpgraded,
  getBuildingUpgradeSupplyCost,
  activateFoundationTargeting,
} from '../engine/buildings.ts';
import type { BuildingType } from '../types';
import { activateRepairTargeting } from '../engine/abilities.ts';
import {
  getArtilleryAreaSquareKeys,
  getGaussLineSquareKeysFromTarget,
  hasBallisticStatus,
} from '../engine/artillery.ts';
import { syncBoardVisualState } from '../shared/events.ts';
import { getPlayerName, getMyPlayerId, isMyTurn } from '../playerNames.ts';
import { dispatch } from '../actionDispatcher.ts';

export function getPlayerMaxEnergy(player: Player): number {
  return player?.maxEnergy ?? MAX_ENERGY;
}

/**
 * Reads the active *_status_pick mode and pulls out the matching
 * {buildingType, squareKey, statusId} so the confirm-button handler can
 * dispatch a self-contained CONFIRM_BUILDING_PLACEMENT action.
 *
 * Returns null when state.mode is not a building status-pick (e.g. the
 * upgrade flow, which stays a separate action).
 */
function readBuildingPlacementFromState(): { buildingType: BuildingType; squareKey: string; statusId: StatusId } | null {
  const map: Array<{ mode: string; type: BuildingType; squareKey: string | null; statusId: StatusId | null }> = [
    { mode: 'armory_status_pick', type: 'ARMORY', squareKey: state.pendingArmorySquareKey, statusId: state.pendingArmoryStatusId },
    { mode: 'replicator_status_pick', type: 'REPLICATOR', squareKey: state.pendingReplicatorSquareKey, statusId: state.pendingReplicatorStatusId },
    { mode: 'workshop_status_pick', type: 'WORKSHOP', squareKey: state.pendingWorkshopSquareKey, statusId: state.pendingWorkshopStatusId },
    { mode: 'datacenter_status_pick', type: 'DATACENTER', squareKey: state.pendingDatacenterSquareKey, statusId: state.pendingDatacenterStatusId },
    { mode: 'gear_station_status_pick', type: 'GEAR_STATION', squareKey: state.pendingGearStationSquareKey, statusId: state.pendingGearStationStatusId },
    { mode: 'assembly_line_status_pick', type: 'ASSEMBLY_LINE', squareKey: state.pendingAssemblyLineSquareKey, statusId: state.pendingAssemblyLineStatusId },
  ];
  const match = map.find((m) => state.mode === m.mode);
  if (!match || !match.squareKey || !match.statusId) return null;
  return { buildingType: match.type, squareKey: match.squareKey, statusId: match.statusId };
}

export function refreshPlayerMaxEnergy(playerId: PlayerId, clampEnergy: boolean = true): number {
  const player = state.players[playerId];
  if (!player) {
    return MAX_ENERGY;
  }
  const datacenterCount = (player.buildings ?? []).filter((building) => building.type === 'DATACENTER').length;
  const computedMaxEnergy = MAX_ENERGY + datacenterCount * 5;
  setMaxEnergy(player, computedMaxEnergy);
  if (clampEnergy) {
    setEnergy(player, Math.min(player.energy, computedMaxEnergy));
  }
  return computedMaxEnergy;
}

export function renderUI(): void {
  // renderUI is read-only on game state. `player.maxEnergy` is kept in sync
  // by the events that actually change it (createBuilding,
  // confirmFoundationUse, destroyBase, startTurn). No mutating recompute here.
  const currentPlayer = getCurrentPlayer();
  const playerA = state.players.A;
  const playerB = state.players.B;
  const aHp = state.players.A.baseHitPoints;
  const bHp = state.players.B.baseHitPoints;
  const aMaxHp = Math.max(1, state.players.A.baseMaxHitPoints ?? BASE_MAX_HIT_POINTS);
  const bMaxHp = Math.max(1, state.players.B.baseMaxHitPoints ?? BASE_MAX_HIT_POINTS);
  const aPct = Math.max(0, Math.min(100, (aHp / aMaxHp) * 100));
  const bPct = Math.max(0, Math.min(100, (bHp / bMaxHp) * 100));
  const currentPlayerMaxEnergy = getPlayerMaxEnergy(currentPlayer);
  const playerAMaxEnergy = getPlayerMaxEnergy(playerA);
  const playerBMaxEnergy = getPlayerMaxEnergy(playerB);
  const energyPct = Math.max(0, Math.min(100, (currentPlayer.energy / currentPlayerMaxEnergy) * 100));

  const myPid = getMyPlayerId();
  const turnLabel = myPid === null
    ? `${getPlayerName(currentPlayer.id)}'s Turn`
    : (isMyTurn(currentPlayer.id) ? `Your Turn (${getPlayerName(currentPlayer.id)})` : `Opponent's Turn (${getPlayerName(currentPlayer.id)})`);
  const youBadge = myPid !== null ? `<span class="you-badge ${myPid.toLowerCase()}">You: ${getPlayerName(myPid)} (${myPid})</span>` : '';

  turnStatusEl.innerHTML = `
    <div class="status-row">
      <div class="status-main">${turnLabel} ${youBadge}</div>
      <div class="base-hp a">
        <div class="base-hp-head">${getPlayerName('A')} <span>${aHp}</span></div>
        <div class="base-hp-track"><div class="base-hp-fill a" style="width: ${aPct}%"></div></div>
      </div>
      <div class="base-hp b">
        <div class="base-hp-head">${getPlayerName('B')} <span>${bHp}</span></div>
        <div class="base-hp-track"><div class="base-hp-fill b" style="width: ${bPct}%"></div></div>
      </div>
      <div class="energy-panel">
        <div class="energy-head">Energy <span>${currentPlayer.energy}/${currentPlayerMaxEnergy}</span></div>
        <div class="energy-track"><div class="energy-fill" style="width: ${energyPct}%"></div></div>
      </div>
    </div>
  `;

  // In multiplayer, disable End Turn when it isn't this player's turn.
  if (endTurnBtn) {
    const myTurn = isMyTurn(currentPlayer.id);
    endTurnBtn.disabled = !myTurn;
    endTurnBtn.classList.toggle('disabled', !myTurn);
  }

  const selectedUnit = getSelectedUnit();
  const selectedOwnedUnit =
    selectedUnit && selectedUnit.owner === currentPlayer.id ? selectedUnit : null;
  const selectedPawnUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'PAWN_DRONE_UNIT' ? selectedOwnedUnit : null;
  const selectedSupportUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'SUPPORT_DRONE_UNIT' ? selectedOwnedUnit : null;
  const selectedGhostbladeUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'GHOSTBLADE_UNIT' ? selectedOwnedUnit : null;
  const selectedArtilleryUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'ARTILLERY_UNIT' ? selectedOwnedUnit : null;
  const selectedSpecialistUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'SPECIALIST_UNIT' ? selectedOwnedUnit : null;

  const selectedMoveRange = selectedOwnedUnit ? getUnitCurrentMoveRange(selectedOwnedUnit) : 0;
  const selectedAttackRange = selectedOwnedUnit ? getUnitCurrentAttackRange(selectedOwnedUnit) : 0;
  const selectedAttackDamage = selectedOwnedUnit ? getUnitCurrentAttackDamage(selectedOwnedUnit) : 0;
  const selectedTankUnit =
    selectedOwnedUnit && selectedOwnedUnit.unitTypeId === 'TANK_DRONE_UNIT' ? selectedOwnedUnit : null;
  const dashOnCooldown = selectedPawnUnit ? selectedPawnUnit.tacticalDashCooldown > 0 : false;
  const dashButtonDisabled =
    !selectedPawnUnit || dashOnCooldown || selectedPawnUnit.tacticalDashActiveThisTurn;
  const dashStatus = selectedPawnUnit
    ? selectedPawnUnit.tacticalDashActiveThisTurn
      ? 'Active this turn'
      : dashOnCooldown
        ? 'On cooldown'
        : 'Ready'
    : 'Select your Pawn Drone';
  const coreMagnetOnCooldown = selectedTankUnit ? selectedTankUnit.coreMagnetCooldown > 0 : false;
  const selectedTankBeacon = selectedTankUnit ? hasBeaconCoreMagnet(selectedTankUnit) : false;
  const selectedTankHasBulwark = selectedTankUnit ? unitHasStatus(selectedTankUnit, DRONE_STATUS_LIBRARY.BULWARK.id) : false;
  const coreMagnetPreviewActive =
    selectedTankUnit && state.coreMagnetPreviewUnitId === selectedTankUnit.id;
  const coreMagnetBulwarkTargetingActive =
    selectedTankUnit &&
    selectedTankHasBulwark &&
    state.mode === 'core_magnet_bulwark_targeting' &&
    state.coreMagnetPreviewUnitId === selectedTankUnit.id;
  const coreMagnetButtonDisabled =
    !selectedTankUnit ||
    isUnitMovementStunned(selectedTankUnit) ||
    (!selectedTankBeacon && coreMagnetOnCooldown) ||
    (!selectedTankBeacon && selectedTankUnit.coreMagnetTurnsLeft > 0) ||
    coreMagnetPreviewActive;
  const coreMagnetStatus = selectedTankUnit
    ? isUnitMovementStunned(selectedTankUnit)
      ? 'Unavailable while Dazzled'
      : selectedTankUnit.coreMagnetTurnsLeft > 0
      ? selectedTankBeacon
        ? 'Channeled (Beacon active, click ability to cancel)'
        : `Channeled (${selectedTankUnit.coreMagnetTurnsLeft} turn left)`
      : !selectedTankBeacon && coreMagnetOnCooldown
        ? 'On cooldown'
        : selectedTankBeacon
          ? 'Ready (Beacon: no cooldown)'
          : 'Ready'
    : 'Select your Tank Drone';
  const selectedSpecialistHasScholar =
    selectedSpecialistUnit ? unitHasStatus(selectedSpecialistUnit, DRONE_STATUS_LIBRARY.SCHOLAR.id) : false;
  const selectedRepairCaster = selectedSupportUnit ?? (selectedSpecialistHasScholar ? selectedSpecialistUnit : null);
  const selectedRepairCasterHasSmart = selectedRepairCaster ? unitHasStatus(selectedRepairCaster, DRONE_STATUS_LIBRARY.SMART.id) : false;
  const repairEnergyCost = selectedRepairCasterHasSmart ? 0 : 5;
  const repairOnCooldown = selectedRepairCaster ? selectedRepairCaster.repairCooldown > 0 : false;
  const repairTargetingActive =
    selectedRepairCaster && state.mode === 'repair_targeting' && state.repairTargetingCasterId === selectedRepairCaster.id;
  const repairButtonDisabled =
    !selectedRepairCaster || repairOnCooldown || getCurrentPlayer().energy < repairEnergyCost || repairTargetingActive;
  const repairStatus = selectedRepairCaster
    ? repairTargetingActive
      ? 'Targeting'
      : repairOnCooldown
        ? 'On cooldown'
        : getCurrentPlayer().energy < repairEnergyCost
          ? `Need ${repairEnergyCost} Energy`
          : 'Ready'
    : 'Select Support Drone or Scholar Specialist';
  const ghostTeleportOnCooldown = selectedGhostbladeUnit ? selectedGhostbladeUnit.ghostbladeTeleportCooldown > 0 : false;
  const ghostTeleportTargetingActive =
    selectedGhostbladeUnit &&
    state.mode === 'ghostblade_teleport_targeting' &&
    state.ghostbladeTeleportCasterId === selectedGhostbladeUnit.id;
  const ghostTeleportButtonDisabled =
    !selectedGhostbladeUnit || ghostTeleportOnCooldown || getCurrentPlayer().energy < 10 || ghostTeleportTargetingActive;
  const ghostTeleportStatus = selectedGhostbladeUnit
    ? ghostTeleportTargetingActive
      ? 'Targeting'
      : ghostTeleportOnCooldown
        ? `On cooldown (${selectedGhostbladeUnit.ghostbladeTeleportCooldown})`
        : getCurrentPlayer().energy < 10
          ? 'Need 10 Energy'
          : 'Ready'
    : 'Select your Ghostblade';
  const artillerySetUpTargeting =
    selectedArtilleryUnit &&
    state.mode === 'artillery_attack_targeting' &&
    state.selectedUnitId === selectedArtilleryUnit.id;
  const artilleryAttackUnlocked = selectedArtilleryUnit ? selectedArtilleryUnit.artillerySetUpActive : false;
  const artillerySetUpOnCooldown = selectedArtilleryUnit ? selectedArtilleryUnit.artillerySetUpCooldown > 0 : false;
  const artillerySetUpDisabled =
    !selectedArtilleryUnit ||
    selectedArtilleryUnit.artillerySetUpUsedThisTurn ||
    (!selectedArtilleryUnit.artillerySetUpActive && artillerySetUpOnCooldown);
  const artillerySetUpStatus = selectedArtilleryUnit
    ? selectedArtilleryUnit.artillerySetUpActive
      ? 'Active'
      : selectedArtilleryUnit.artillerySetUpUsedThisTurn
        ? 'Used this turn'
        : artillerySetUpOnCooldown
          ? `On cooldown (${selectedArtilleryUnit.artillerySetUpCooldown})`
          : 'Ready'
    : 'Select your Artillery';
  const specialistEmpOnCooldown = selectedSpecialistUnit ? selectedSpecialistUnit.specialistEmpCooldown > 0 : false;
  const specialistEmpCooldownTurns = selectedSpecialistUnit ? getSpecialistEmpCooldownTurns(selectedSpecialistUnit) : 2;
  const selectedSpecialistHasSalvo = selectedSpecialistUnit ? hasSalvoEmpStatus(selectedSpecialistUnit) : false;
  const specialistEmpUsesThisTurn = selectedSpecialistUnit ? selectedSpecialistUnit.specialistEmpUsesThisTurn ?? 0 : 0;
  const specialistEmpUsesLimit = selectedSpecialistHasSalvo ? 2 : 1;
  const specialistCanEmpAfterAttack = selectedSpecialistHasSalvo && specialistEmpUsesThisTurn < specialistEmpUsesLimit;
  const specialistEmpTargetingActive =
    selectedSpecialistUnit &&
    state.mode === 'specialist_emp_targeting' &&
    state.specialistEmpCasterId === selectedSpecialistUnit.id;
  const specialistEmpButtonDisabled =
    !selectedSpecialistUnit ||
    specialistEmpOnCooldown ||
    (selectedSpecialistUnit.hasAttacked && !specialistCanEmpAfterAttack) ||
    (selectedSpecialistHasSalvo && specialistEmpUsesThisTurn >= specialistEmpUsesLimit) ||
    getCurrentPlayer().energy < 5 ||
    specialistEmpTargetingActive;
  const specialistEmpStatus = selectedSpecialistUnit
    ? specialistEmpTargetingActive
      ? 'Targeting'
      : specialistEmpOnCooldown
        ? `On cooldown (${selectedSpecialistUnit.specialistEmpCooldown})`
        : selectedSpecialistHasSalvo && specialistEmpUsesThisTurn >= specialistEmpUsesLimit
          ? 'Salvo limit reached'
        : selectedSpecialistUnit.hasAttacked && !specialistCanEmpAfterAttack
          ? 'Unavailable after attack'
        : getCurrentPlayer().energy < 5
          ? 'Need 5 Energy'
          : selectedSpecialistHasSalvo
            ? `Ready (${specialistEmpUsesThisTurn}/${specialistEmpUsesLimit})`
            : 'Ready'
    : 'Select your Specialist';
  const attackTargetingActive =
    selectedOwnedUnit &&
    (state.mode === 'attack_targeting' || state.mode === 'artillery_attack_targeting') &&
    state.selectedUnitId === selectedOwnedUnit.id;
  const tankFaceEaterCooldown =
    selectedTankUnit && unitHasStatus(selectedTankUnit, DRONE_STATUS_LIBRARY.FACE_EATER.id)
      ? selectedTankUnit.tankFaceEaterAttackCooldown ?? 0
      : 0;
  const attackButtonDisabled =
    !selectedOwnedUnit ||
    (selectedArtilleryUnit && !artilleryAttackUnlocked) ||
    isUnitMovementStunned(selectedOwnedUnit) ||
    tankFaceEaterCooldown > 0 ||
    (selectedOwnedUnit.hasMoved && !canUnitAttackAfterMoving(selectedOwnedUnit)) ||
    (selectedOwnedUnit.hasAttacked && !selectedOwnedUnit.systemShockFollowUpReady) ||
    (isUnitPlanted(selectedOwnedUnit) && !hasBeaconCoreMagnet(selectedOwnedUnit));
  const attackStatus = selectedOwnedUnit
    ? isUnitPlanted(selectedOwnedUnit) && !hasBeaconCoreMagnet(selectedOwnedUnit)
      ? 'Unavailable while Planted'
      : isUnitMovementStunned(selectedOwnedUnit)
        ? 'Unavailable while Dazzled'
      : tankFaceEaterCooldown > 0
        ? `On cooldown (${tankFaceEaterCooldown})`
      : selectedArtilleryUnit && !artilleryAttackUnlocked
        ? 'Need Set Up status'
      : selectedOwnedUnit.hasMoved && !canUnitAttackAfterMoving(selectedOwnedUnit)
        ? 'Unavailable after moving'
      : selectedOwnedUnit.hasAttacked
        ? selectedOwnedUnit.systemShockFollowUpReady
          ? 'Ready (System Shock follow-up)'
          : 'Already attacked'
        : attackTargetingActive
          ? 'Targeting'
          : 'Ready'
    : 'Select your drone';
  const builtBuildings = [...currentPlayer.buildings];

  interface StatusDisplayItem {
    key?: string;
    glyph: string;
    label: string;
    tooltip: string;
    [prop: string]: unknown;
  }
  const statusItems: StatusDisplayItem[] = [];
  if (selectedOwnedUnit?.passiveStatuses?.length) {
    const filteredPassiveStatuses =
      selectedOwnedUnit.unitTypeId === 'TANK_DRONE_UNIT'
        ? selectedOwnedUnit.passiveStatuses.filter((status) => status.statusId !== DRONE_STATUS_LIBRARY.ATAKK.id)
        : selectedOwnedUnit.passiveStatuses;
    statusItems.push(...filteredPassiveStatuses.map((s) => ({ key: s.statusId, glyph: s.iconGlyph, label: s.statusName, tooltip: s.statusName })));
  }
  if (selectedOwnedUnit?.adjacencyStatuses?.length) {
    const visibleAdjacencyStatuses = (selectedOwnedUnit.adjacencyStatuses as unknown as StatusDisplayItem[]).filter(
      (status) => status.key !== 'adj_assembly_line_cost'
    );
    statusItems.push(...visibleAdjacencyStatuses);
  }
  if (selectedPawnUnit?.tacticalDashActiveThisTurn) {
    statusItems.push({
      key: 'tactical_dash',
      glyph: '&#127939;',
      label: '+1 Move',
      tooltip: 'This drone has +1 Movement until the end of Turn'
    });
  }
  if (selectedTankUnit && selectedTankUnit.coreMagnetTurnsLeft > 0) {
    statusItems.push({
      key: 'planted',
      glyph: '&#129408;',
      label: hasBeaconCoreMagnet(selectedTankUnit) ? 'Planted' : `Planted: ${selectedTankUnit.coreMagnetTurnsLeft}`,
      tooltip: hasBeaconCoreMagnet(selectedTankUnit)
        ? 'Tank Drone is Planted until canceled, channel is broken, or Drone is destroyed. It attracts all shots made through the Covered Area.'
        : `Tank Drone is Planted and cannot move for ${selectedTankUnit.coreMagnetTurnsLeft} turns. It attracts all shots made through the Covered Area`
    });
  }
  if (selectedTankUnit && unitHasStatus(selectedTankUnit, DRONE_STATUS_LIBRARY.ATAKK.id)) {
    const atFullHp = selectedTankUnit.hitPoints >= selectedTankUnit.maxHitPoints;
    statusItems.push({
      key: 'atakk_dynamic',
      glyph: DRONE_STATUS_LIBRARY.ATAKK.iconGlyph,
      label: atFullHp ? 'Atakk' : 'Atakk (Deact)',
      tooltip: atFullHp
        ? 'Atakk gives +2 MOV at Full HP.'
        : 'Atakk will give +2MOV, when this Drone is at Full HP.'
    });
  }
  if (selectedArtilleryUnit?.artillerySetUpActive) {
    statusItems.push({
      key: 'artillery_setup',
      glyph: '&#128736;',
      label: 'Set Up',
      tooltip: 'Artillery is deployed and can use its bombard attack.'
    });
  }
  if (selectedOwnedUnit && isUnitMovementStunned(selectedOwnedUnit)) {
    statusItems.push({
      key: 'dazzled',
      glyph: '&#9889;',
      label: `Dazzled: ${selectedOwnedUnit.empStunnedTurns}`,
      tooltip: `This Drone is Stunned for ${selectedOwnedUnit.empStunnedTurns} turns`
    });
  }
  if (selectedOwnedUnit && (selectedOwnedUnit.shieldHitPoints ?? 0) > 0) {
    statusItems.push({
      key: 'shield',
      glyph: '&#128737;&#65039;',
      label: 'Shield',
      tooltip: `This unit is Shielded and has ${(selectedOwnedUnit.shieldHitPoints ?? 0)} bonus HP`
    });
  }
  if (selectedOwnedUnit && (selectedOwnedUnit.augmentedAttackBonus ?? 0) > 0) {
    const bonusAttack = selectedOwnedUnit.augmentedAttackBonus ?? 0;
    statusItems.push({
      key: 'augmented',
      glyph: '&#9881;',
      label: 'Augmented',
      tooltip: `${bonusAttack} DMG increased by the Engineers.`
    });
  }
  if (selectedOwnedUnit && ((selectedOwnedUnit.virusDebuffPendingTurns ?? 0) > 0 || (selectedOwnedUnit.virusDebuffActiveTurns ?? 0) > 0)) {
    const isActive = (selectedOwnedUnit.virusDebuffActiveTurns ?? 0) > 0;
    const penalty = isActive
      ? (selectedOwnedUnit.virusAttackPenaltyActive ?? 0)
      : (selectedOwnedUnit.virusAttackPenaltyPending ?? 0);
    statusItems.push({
      key: 'virus',
      glyph: '<span style="color:#ef4444;">&#128027;&#65038;</span>',
      label: 'Virus',
      tooltip: isActive
        ? `Virus active: -${penalty} ATT during this turn.`
        : `Virus queued: -${penalty} ATT on next turn.`
    });
  }
  const statusesHtml =
    statusItems.length > 0
      ? statusItems
          .map(
            (status) => `
        <div class="improvement-icon" aria-label="${status.label}">
          <span class="improvement-glyph">${status.glyph}</span>
          <span class="improvement-label">${status.label}</span>
          <span class="improvement-tooltip">${status.tooltip}</span>
        </div>
      `
          )
          .join('')
      : `<div class="improvement-empty">No active statuses.</div>`;
  const overloadTargetingActive = state.mode === 'overload_targeting';
  const buildingSegmentsHtml = (() => {
    const segments = [];
    for (const building of builtBuildings.slice(0, 6)) {
      const adjacencyBonus = getBuildingAdjacencyIconGlyph(building);
      const upgradesIconsHtml = getBuildingCardUpgradeIconsHtml(currentPlayer.id, building);
      const abilityCardsHtml = getBuildingAbilityCardsHtml(building, currentPlayer, overloadTargetingActive);
      const canUpgrade = canBuildingBeUpgraded(building);
      const upgradeCost = getBuildingUpgradeSupplyCost(building);
      const canAffordUpgrade = currentPlayer.supply >= upgradeCost;
      const upgradeLabel = canUpgrade
        ? building.upgraded
          ? 'Upgraded'
          : `Upgrade: ${upgradeCost} SUP`
        : 'Upgrade: —';
      segments.push(`
        <div class="building-segment">
          <div class="building-segment-head" title="${getBuildingDisplayName(building)}">${getBuildingDisplayName(building)}</div>
          <div class="building-segment-meta">
            <div class="building-segment-meta-line">
              <span class="building-meta-label">Adj. Bonus</span>
              <span class="building-upgrade-icons">
                ${
                  adjacencyBonus
                    ? `<span class="building-upgrade-icon large">${adjacencyBonus.glyph}<span class="building-upgrade-tooltip">${adjacencyBonus.tooltip}</span></span>`
                    : '<span class="building-upgrade-empty">—</span>'
                }
              </span>
            </div>
            <div class="building-segment-meta-line">
              <span class="building-meta-label">Card Upgrades</span>
              <span class="building-upgrade-icons">${upgradesIconsHtml}</span>
            </div>
          </div>
          <div class="building-segment-abilities">
            ${abilityCardsHtml}
          </div>
          <button class="building-upgrade-btn" type="button" data-upgrade-building-id="${building.id}" ${!canUpgrade || building.upgraded || !canAffordUpgrade ? 'disabled' : ''}>${upgradeLabel}</button>
        </div>
      `);
    }
    while (segments.length < 6) {
      segments.push(`
        <div class="building-segment empty">
          <div class="building-segment-head">Empty Slot</div>
          <div class="building-segment-meta">
            <div class="building-segment-meta-line"><span class="building-meta-label">Adj. Bonus</span><span class="building-upgrade-icons"><span class="building-upgrade-empty">—</span></span></div>
            <div class="building-segment-meta-line"><span class="building-meta-label">Card Upgrades</span><span class="building-upgrade-icons"><span class="building-upgrade-empty">—</span></span></div>
          </div>
          <div class="building-segment-abilities"><div class="improvement-empty">Build a structure.</div></div>
          <button class="building-upgrade-btn" type="button" disabled>Upgrade: —</button>
        </div>
      `);
    }
    return `<div class="building-abilities-grid">${segments.join('')}</div>`;
  })();

  const droneSectionsHtml = selectedOwnedUnit
    ? `
      <div class="drone-sections">
        <div class="drone-section">
          <div class="drone-section-title">Drone Abilities</div>
          ${
            selectedOwnedUnit
              ? `
                <button id="abilityAttack" class="ability-card" ${attackButtonDisabled ? 'disabled' : ''}>
                  <span class="ability-name">${
                    selectedArtilleryUnit
                      ? hasBallisticStatus(selectedArtilleryUnit)
                        ? 'Attack: Ballistic'
                        : unitHasStatus(selectedArtilleryUnit, DRONE_STATUS_LIBRARY.GAUSS.id)
                          ? 'Attack: Gauss'
                          : 'Attack: Shell'
                      : 'Attack'
                  }</span>
                  <span class="ability-line">Attack damage: ${selectedAttackDamage}</span>
                  <span class="ability-line">Attack range: ${selectedAttackRange}</span>
                  <span class="ability-state">Status: ${attackStatus}</span>
                </button>
              `
              : ''
          }
          ${
            selectedPawnUnit
              ? `
                <button id="abilityTacticalDash" class="ability-card" ${dashButtonDisabled ? 'disabled' : ''}>
                  <span class="ability-name">Tactical Dash</span>
                  <span class="ability-line">Drone gets +1 Movement for this turn and can move after attacking.</span>
                  <span class="ability-line">Cooldown: 2 turns</span>
                  <span class="ability-state">Status: ${dashStatus}</span>
                </button>
              `
                : selectedTankUnit
                ? `
                <button id="abilityCoreMagnet" class="ability-card" ${coreMagnetButtonDisabled ? 'disabled' : ''}>
                  <span class="ability-name">Core Magnet</span>
                  <span class="ability-line">${
                    selectedTankBeacon
                      ? 'Repairs 5 HP on first activation each turn. Plants Tank Drone and attracts shots in covered area until canceled.'
                      : 'Repairs 5 HP and plants Tank Drone at location. Attract all shots in covered area.'
                  }</span>
                  <span class="ability-line">${
                    selectedTankBeacon
                      ? 'Cooldown: none | Duration: none (cancel manually to move) | Channeling'
                      : 'Cooldown: 2 turns | Duration: 2 turns | Channeling'
                  }</span>
                  <span class="ability-state">Status: ${coreMagnetStatus}</span>
                </button>
                ${
                  coreMagnetPreviewActive && !selectedTankHasBulwark
                    ? `
                      <div class="ability-confirm">
                        <div class="ability-confirm-text">Activate Core Magnet on this Tank Drone?</div>
                        <div class="ability-confirm-actions">
                          <button id="confirmCoreMagnet" class="ability-confirm-btn">Confirm</button>
                          <button id="cancelCoreMagnet" class="ability-cancel-btn">Cancel</button>
                        </div>
                      </div>
                    `
                    : ''
                }
                ${
                  coreMagnetBulwarkTargetingActive
                    ? `
                      <div class="ability-confirm">
                        <div class="ability-confirm-text">Bulwark active: choose one adjacent square direction.</div>
                        <div class="ability-confirm-actions">
                          <button id="cancelCoreMagnet" class="ability-cancel-btn">Cancel</button>
                        </div>
                      </div>
                    `
                    : ''
                }
              `
                : selectedSupportUnit
                  ? `
                    <button id="abilityRepair" class="ability-card" ${repairButtonDisabled ? 'disabled' : ''}>
                      <span class="ability-name">Repair</span>
                      <span class="ability-line">Restore 50% of max HP to an allied drone in range.</span>
                      <span class="ability-line">Range: ${selectedSupportUnit.attackRange} | Cooldown: 1 turn | Energy: ${repairEnergyCost}${selectedRepairCasterHasSmart ? ' (Smart)' : ''}</span>
                      <span class="ability-line">Cannot target self or enemies.</span>
                      <span class="ability-state">Status: ${repairStatus}</span>
                    </button>
                  `
                  : selectedGhostbladeUnit
                    ? `
                    <button id="abilityGhostbladeTeleport" class="ability-card" ${ghostTeleportButtonDisabled ? 'disabled' : ''}>
                      <span class="ability-name">Teleport</span>
                      <span class="ability-line">Blink to an empty square and deal AoE damage in a 3x3 area.</span>
                      <span class="ability-line">Energy: 10 | Cooldown: 4</span>
                      <span class="ability-state">Status: ${ghostTeleportStatus}</span>
                    </button>
                  `
                  : selectedArtilleryUnit
                    ? `
                    <button id="abilityArtillerySetUp" class="ability-card" ${artillerySetUpDisabled ? 'disabled' : ''}>
                      <span class="ability-name">Set Up</span>
                      <span class="ability-line">Channel artillery deployment to enable bombard attack.</span>
                      <span class="ability-line">Cooldown: 2 turns | Channeling | Once per turn</span>
                      <span class="ability-state">Status: ${artillerySetUpStatus}</span>
                    </button>
                  `
                  : selectedSpecialistUnit
                    ? `
                    ${
                      selectedSpecialistHasScholar
                        ? `
                          <button id="abilityRepair" class="ability-card" ${repairButtonDisabled ? 'disabled' : ''}>
                            <span class="ability-name">Repair</span>
                            <span class="ability-line">Restore 50% of max HP to an allied drone in range.</span>
                            <span class="ability-line">Range: ${selectedSpecialistUnit.attackRange} | Cooldown: 1 turn | Energy: ${repairEnergyCost}${selectedRepairCasterHasSmart ? ' (Smart)' : ''}</span>
                            <span class="ability-line">Cannot target self or enemies.</span>
                            <span class="ability-state">Status: ${repairStatus}</span>
                          </button>
                        `
                        : ''
                    }
                    <button id="abilitySpecialistEmp" class="ability-card" ${specialistEmpButtonDisabled ? 'disabled' : ''}>
                      <span class="ability-name">EMP</span>
                      <span class="ability-line">Target a 2x2 area. Applies EMP effect to all drones there.</span>
                      <span class="ability-line">Energy: 5 | Range: ${selectedAttackRange} | Cooldown: ${specialistEmpCooldownTurns}</span>
                      <span class="ability-state">Status: ${specialistEmpStatus}</span>
                    </button>
                  `
                  : `<div class="improvement-empty">No abilities available for this drone.</div>`
          }
        </div>
        <div class="drone-section">
          <div class="drone-section-title">Drone Statuses</div>
          <div class="improvement-row">
            ${statusesHtml}
          </div>
        </div>
      </div>
    `
    : `
      <div class="drone-sections single">
        <div class="drone-section">
          <div class="drone-section-title">Building Abilities</div>
          ${buildingSegmentsHtml}
        </div>
      </div>
    `;
  const armoryBuildCard = BUILD_CARD_LIBRARY.ARMORY;
  const replicatorBuildCard = BUILD_CARD_LIBRARY.REPLICATOR;
  const workshopBuildCard = BUILD_CARD_LIBRARY.WORKSHOP;
  const datacenterBuildCard = BUILD_CARD_LIBRARY.DATACENTER;
  const gearStationBuildCard = BUILD_CARD_LIBRARY.GEAR_STATION;
  const assemblyLineBuildCard = BUILD_CARD_LIBRARY.ASSEMBLY_LINE;
  const foundationBuildCard = BUILD_CARD_LIBRARY.FOUNDATION;
  const isArmoryPlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === armoryBuildCard.id;
  const isReplicatorPlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === replicatorBuildCard.id;
  const isWorkshopPlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === workshopBuildCard.id;
  const isDatacenterPlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === datacenterBuildCard.id;
  const isGearStationPlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === gearStationBuildCard.id;
  const isAssemblyLinePlacementSelected =
    state.mode === 'place_building' && state.placingBuildingType === assemblyLineBuildCard.id;
  const isFoundationModeSelected = state.mode === 'foundation_targeting' || state.mode === 'foundation_confirm';
  const canAffordArmory = currentPlayer.supply >= armoryBuildCard.supplyCost;
  const canAffordReplicator = currentPlayer.supply >= replicatorBuildCard.supplyCost;
  const canAffordWorkshop = currentPlayer.supply >= workshopBuildCard.supplyCost;
  const canAffordDatacenter = currentPlayer.supply >= datacenterBuildCard.supplyCost;
  const canAffordGearStation = currentPlayer.supply >= gearStationBuildCard.supplyCost;
  const canAffordAssemblyLine = currentPlayer.supply >= assemblyLineBuildCard.supplyCost;
  const canAffordFoundation = currentPlayer.supply >= foundationBuildCard.supplyCost;
  const activeBuildingsList = currentPlayer.buildings
    .map((building) => `${getBuildingDisplayName(building)} (${building.squareKey})`)
    .join(', ');

  handEl.innerHTML = `
    <div class="hand-layout">
      <div class="hand-panel">
        <div class="hand-title">Player ${currentPlayer.id} Hand (${currentPlayer.hand.length})</div>
        <div class="card-row">
          ${currentPlayer.hand
            .map((card, index) => {
              const cardTemplate = CARD_LIBRARY[card.cardId];
              const effectiveCardCost = getCardEnergyCost(card);
              const isSelected =
                (state.mode === 'play_card' ||
                  state.mode === 'harvest_absorb' ||
                  state.mode === 'system_shock_card' ||
                  state.mode === 'shielding_card') &&
                state.selectedCardHandIndex === index;
              const disabled =
                state.mode === 'harvest_absorb'
                  ? false
                  : cardTemplate.id === CARD_LIBRARY.SYSTEM_SHOCK.id ||
                    cardTemplate.id === CARD_LIBRARY.SHIELDING.id ||
                    cardTemplate.id === CARD_LIBRARY.SHIMMERING_CLOAK.id
                  ? false
                  : currentPlayer.energy < effectiveCardCost;
              const producedAtLine =
                cardTemplate.cardCategory === 'Drone'
                  ? `<span class="card-prop">Produced at: ${card.producedAt ?? 'Base'}</span>`
                  : '';
              const perkLine =
                cardTemplate.id === CARD_LIBRARY.HARVEST_DATA.id
                  ? `<span class="card-prop">Absorb 1 Drone card: gain its Energy Cost as Supply</span>`
                  : cardTemplate.id === CARD_LIBRARY.SYSTEM_SHOCK.id
                    ? `<span class="card-prop">Cast on eligible enemy drone: Level 1 (cost ${cardTemplate.energyCost} Energy), or store in Process Echo X</span>`
                    : cardTemplate.id === CARD_LIBRARY.SHIELDING.id
                      ? `<span class="card-prop">Instant: apply Shielding Level 1 (cost ${cardTemplate.energyCost} Energy), or store in Process Echo X</span>`
                      : cardTemplate.id === CARD_LIBRARY.SHIMMERING_CLOAK.id
                        ? `<span class="card-prop">Target square: Level 1 (1 square, 1 turn), or store in Process Echo X</span>`
                  : '';

              return `
                <button class="card ${isSelected ? 'selected' : ''}" data-hand-index="${index}" ${disabled ? 'disabled' : ''}>
                  <span class="card-name">${cardTemplate.cardName}</span>
                  <span class="card-prop">Type: ${cardTemplate.cardCategory}</span>
                  <span class="card-prop">Cost: ${effectiveCardCost}${effectiveCardCost !== cardTemplate.energyCost ? ` (base ${cardTemplate.energyCost})` : ''}</span>
                  ${cardTemplate.cardType === 'unit_summon' ? `<span class="card-prop">Summon: ${UNIT_LIBRARY[cardTemplate.summonUnitId].unitName}</span>` : ''}
                  ${perkLine}
                  ${producedAtLine}
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
      <div class="drone-panel-slot">
        ${droneSectionsHtml}
      </div>
      <div class="build-panel">
        <div class="build-title">Build Section</div>
        <div class="build-copy">Obtain building cards by spending Supply.</div>
        <button class="build-card ${isArmoryPlacementSelected ? 'selected' : ''}" id="buildCardArmory" ${!canAffordArmory || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83D\uDEE1\uFE0F</span><span class="build-card-name">${armoryBuildCard.cardName}</span></span><span class="build-card-cost">${armoryBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Place on your base square. Unlocks: Create Tank Drone. Adjacency bonus: +1 HP to Drone cards produced by adjacent buildings.</span>
        </button>
        <button class="build-card ${isReplicatorPlacementSelected ? 'selected' : ''}" id="buildCardReplicator" ${!canAffordReplicator || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83C\uDFED</span><span class="build-card-name">${replicatorBuildCard.cardName}</span></span><span class="build-card-cost">${replicatorBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Place on your base square. Unlocks: Create Pawn Drone. Adjacency bonus: +1 ATT to Drone cards produced by adjacent buildings.</span>
        </button>
        <button class="build-card ${isWorkshopPlacementSelected ? 'selected' : ''}" id="buildCardWorkshop" ${!canAffordWorkshop || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83D\uDD27</span><span class="build-card-name">${workshopBuildCard.cardName}</span></span><span class="build-card-cost">${workshopBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Place on your base square. Unlocks: Create Support Drone. Adjacency bonus: +50% Supply yield for Drone cards produced by adjacent buildings.</span>
        </button>
        <button class="build-card ${isDatacenterPlacementSelected ? 'selected' : ''}" id="buildCardDatacenter" ${!canAffordDatacenter || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83D\uDDA5\uFE0F</span><span class="build-card-name">${datacenterBuildCard.cardName}</span></span><span class="build-card-cost">${datacenterBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Effect: +5 Max Energy. Unlocks Obtain (5 Energy to gain 5 Supply, or 8 if adjacent to Workshop), once per turn.</span>
        </button>
        <button class="build-card ${isGearStationPlacementSelected ? 'selected' : ''}" id="buildCardGearStation" ${!canAffordGearStation || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\u2699\uFE0F</span><span class="build-card-name">${gearStationBuildCard.cardName}</span></span><span class="build-card-cost">${gearStationBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Adjacency: +1 MOV to cards produced by adjacent buildings. Unlocks Overload (5 Energy, once per turn).</span>
        </button>
        <button class="build-card ${isAssemblyLinePlacementSelected ? 'selected' : ''}" id="buildCardAssemblyLine" ${!canAffordAssemblyLine || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83C\uDFD7\uFE0F</span><span class="build-card-name">${assemblyLineBuildCard.cardName}</span></span><span class="build-card-cost">${assemblyLineBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Adjacency: Drone cards produced by adjacent buildings cost 3 less Energy. Unlocks Draw (2 Energy: draw 1 card).</span>
        </button>
        <button class="build-card ${isFoundationModeSelected ? 'selected' : ''}" id="buildCardFoundation" ${!canAffordFoundation || state.winner ? 'disabled' : ''}>
          <span class="build-card-line"><span class="build-card-main"><span class="build-card-icon" aria-hidden="true">\uD83E\uDDF1</span><span class="build-card-name">${foundationBuildCard.cardName}</span></span><span class="build-card-cost">${foundationBuildCard.supplyCost} Supply</span></span>
          <span class="build-card-tooltip">Select one of your built structures and confirm to destroy it. Gain +5 max base HP, +5 current base HP, and refund 50% of destroyed building Supply cost.</span>
        </button>
        <div class="build-active">Active: ${activeBuildingsList || 'None'}</div>
      </div>
    </div>
  `;

  if (state.winner) {
    handEl.innerHTML += `<div class="win-banner">Player ${state.winner} Wins</div>`;
  } else if (state.mode === 'play_card') {
    handEl.innerHTML += `<div class="selection-info">Select a highlighted square adjacent to Player ${currentPlayer.id} base.</div>`;
  } else if (state.mode === 'harvest_absorb') {
    handEl.innerHTML += `<div class="selection-info">Select a Drone card in hand to Absorb with Harvest Data.</div>`;
  } else if (state.mode === 'system_shock_card') {
    handEl.innerHTML += `<div class="selection-info">System Shock selected: click an eligible enemy drone to cast Level 1 (cost 5 Energy), or click Process Echo X to store.</div>`;
  } else if (state.mode === 'shielding_card') {
    handEl.innerHTML += `<div class="selection-info">Shielding selected: click your drone to apply Level 1 (cost 5 Energy), or click Process Echo X to store.</div>`;
  } else if (state.mode === 'system_shock_targeting_echo') {
    const level = Math.max(1, Math.min(3, state.pendingSystemShockLevel ?? 1));
    const damage = level >= 2 ? 8 : 5;
    handEl.innerHTML += `<div class="selection-info">System Shock Level ${level} from Process Echo: select an eligible enemy drone. Damage ${damage} (${DAMAGE_TYPES.SYSTEM}).</div>`;
  } else if (state.mode === 'shielding_equip_instant' || state.mode === 'shielding_equip_echo') {
    const sourceText = state.mode === 'shielding_equip_instant' ? 'from hand' : `from Process Echo slot ${state.pendingShieldingSourceSlot}`;
    handEl.innerHTML += `<div class="selection-info">Select one of your drones to apply Shielding ${sourceText}.</div>`;
  } else if (state.mode === 'shimmering_targeting_instant' || state.mode === 'shimmering_targeting_echo') {
    const level =
      state.mode === 'shimmering_targeting_instant'
        ? 1
        : Math.max(1, Math.min(3, state.pendingShimmeringLevel ?? 1));
    const required = level >= 3 ? 2 : 1;
    const picked = state.pendingShimmeringSquares?.length ?? 0;
    handEl.innerHTML += `<div class="selection-info">Shimmering Cloak Level ${level}: select ${required} square(s). Selected ${picked}/${required}.</div>`;
  } else if (state.mode === 'artillery_attack_targeting' && selectedArtilleryUnit) {
    const ballistic = hasBallisticStatus(selectedArtilleryUnit);
    const gauss = unitHasStatus(selectedArtilleryUnit, DRONE_STATUS_LIBRARY.GAUSS.id);
    const preview = state.hoverSquareKey
      ? (gauss
          ? getGaussLineSquareKeysFromTarget(selectedArtilleryUnit, state.hoverSquareKey).join(', ')
          : getArtilleryAreaSquareKeys(state.hoverSquareKey).join(', '))
      : 'none';
    handEl.innerHTML += ballistic
      ? `<div class="selection-info">Artillery Ballistic targeting: select an enemy drone or vulnerable enemy base square in range.</div>`
      : gauss
      ? `<div class="selection-info">Artillery Gauss targeting: choose an adjacent square direction (or one of its highlighted line squares). Preview: ${preview}</div>`
      : `<div class="selection-info">Artillery targeting: choose a 2x2 area at least 2 squares away. Preview: ${preview}</div>`;
  } else if (state.mode === 'specialist_emp_targeting' && selectedSpecialistUnit) {
    const preview = state.hoverSquareKey ? getArtilleryAreaSquareKeys(state.hoverSquareKey).join(', ') : 'none';
    handEl.innerHTML += `<div class="selection-info">Specialist EMP targeting: choose a 2x2 area. Preview: ${preview}</div>`;
  } else if (state.mode === 'core_magnet_bulwark_targeting' && selectedTankUnit) {
    handEl.innerHTML += `<div class="selection-info">Bulwark Core Magnet: hover adjacent square to preview 3-square shield, then click to confirm.</div>`;
  } else if (state.mode === 'overload_targeting') {
    handEl.innerHTML += `<div class="selection-info">Overload targeting: select a friendly drone that can receive movement.</div>`;
  } else if (state.mode === 'attack_targeting' && selectedOwnedUnit) {
    handEl.innerHTML += `<div class="selection-info">Attack targeting: select an enemy unit or enemy base in range. Damage ${selectedAttackDamage}, Range ${selectedAttackRange}.</div>`;
  } else if (state.mode === 'place_building') {
    const selectedBuildCard =
      (state.placingBuildingType ? BUILD_CARD_LIBRARY[state.placingBuildingType] : null) ?? BUILD_CARD_LIBRARY.ARMORY;
    handEl.innerHTML += `<div class="selection-info">Select a highlighted base square to place ${selectedBuildCard.cardName}.</div>`;
  } else if (state.mode === 'foundation_targeting') {
    handEl.innerHTML += `<div class="selection-info">Foundation: select one of your existing buildings to destroy.</div>`;
  } else if (state.mode === 'foundation_confirm') {
    handEl.innerHTML += `<div class="selection-info">Foundation: confirm the selected building destruction.</div>`;
  } else if (selectedOwnedUnit) {
    handEl.innerHTML += `<div class="selection-info">Move range: ${selectedMoveRange}, Attack range: ${selectedOwnedUnit.attackRange}</div>`;
  }

  pileAEl.innerHTML = `
    <div class="pile-title">Player A</div>
    <div class="pile-resource" data-energy>Energy: <strong>${playerA.energy}/${playerAMaxEnergy}</strong></div>
    <div class="pile-resource" data-supply>Supply: ${playerA.supply}</div>
    <div>Deck: ${playerA.deck.length}</div>
    <div>Discard: ${playerA.discard.length}</div>
  `;

  pileBEl.innerHTML = `
    <div class="pile-title">Player B</div>
    <div class="pile-resource" data-energy>Energy: <strong>${playerB.energy}/${playerBMaxEnergy}</strong></div>
    <div class="pile-resource" data-supply>Supply: ${playerB.supply}</div>
    <div>Deck: ${playerB.deck.length}</div>
    <div>Discard: ${playerB.discard.length}</div>
  `;

  if (
    state.mode === 'armory_status_pick' ||
    state.mode === 'replicator_status_pick' ||
    state.mode === 'workshop_status_pick' ||
    state.mode === 'datacenter_status_pick' ||
    state.mode === 'gear_station_status_pick' ||
    state.mode === 'assembly_line_status_pick' ||
    state.mode === 'building_upgrade_status_pick'
  ) {
    const modeConfig = {
      armory_status_pick: {
        pool: 'ARMORY',
        title: 'Choose Armory Drone Status',
        copy: 'Select one status for all Tank Drones produced by this Armory.'
      },
      replicator_status_pick: {
        pool: 'REPLICATOR',
        title: 'Choose Replicator Drone Status',
        copy: 'Select one status for all Pawn Drones produced by this Replicator.'
      },
      workshop_status_pick: {
        pool: 'WORKSHOP',
        title: 'Choose Workshop Drone Status',
        copy: 'Select one status for all Support Drones produced by this Workshop.'
      },
      datacenter_status_pick: {
        pool: 'DATACENTER',
        title: 'Choose Datacenter Drone Status',
        copy: 'Select one status for all Specialist Drones produced by this Datacenter.'
      },
      gear_station_status_pick: {
        pool: 'GEAR_STATION',
        title: 'Choose Gear Station Drone Status',
        copy: 'Select one status for all Ghostblade Drones produced by this Gear Station.'
      },
      assembly_line_status_pick: {
        pool: 'ASSEMBLY_LINE',
        title: 'Choose Assembly Line Drone Status',
        copy: 'Select one status for all Artillery Drones produced by this Assembly Line.'
      },
      building_upgrade_status_pick: {
        pool: '',
        title: 'Choose Upgrade Drone Status',
        copy: 'Select one additional status from this building pool.'
      }
    };
    const cfg = modeConfig[state.mode];
    const draftPoolKey = cfg.pool;
    const statusOptions =
      state.mode === 'building_upgrade_status_pick'
        ? (state.pendingUpgradeStatusOptions ?? []).map((statusId) => DRONE_STATUS_LIBRARY[statusId]).filter(Boolean)
        : (BUILDING_PERK_DRAFT_POOL[draftPoolKey] ?? [])
            .map((statusId) => DRONE_STATUS_LIBRARY[statusId])
            .filter(Boolean);
    const selectedStatusId =
      state.mode === 'armory_status_pick'
        ? state.pendingArmoryStatusId
        : state.mode === 'replicator_status_pick'
          ? state.pendingReplicatorStatusId
          : state.mode === 'workshop_status_pick'
            ? state.pendingWorkshopStatusId
            : state.mode === 'datacenter_status_pick'
              ? state.pendingDatacenterStatusId
              : state.mode === 'gear_station_status_pick'
                ? state.pendingGearStationStatusId
                : state.mode === 'assembly_line_status_pick'
                  ? state.pendingAssemblyLineStatusId
                  : state.pendingUpgradeStatusId;
    const upgradeBuilding =
      state.mode === 'building_upgrade_status_pick' && state.pendingUpgradeBuildingId
        ? getBuildingById(currentPlayer.id, state.pendingUpgradeBuildingId)
        : null;
    const modalTitle =
      state.mode === 'building_upgrade_status_pick' && upgradeBuilding
        ? `Upgrade ${getBuildingDisplayName(upgradeBuilding)}`
        : cfg.title;
    const modalCopy =
      state.mode === 'building_upgrade_status_pick' && upgradeBuilding
        ? `Select one additional status (up to 8 options) from ${getBuildingDisplayName(upgradeBuilding)} pool.`
        : cfg.copy;
    overlayEl.innerHTML = `
      <div class="overlay-backdrop">
        <div class="status-modal">
          <div class="status-modal-title">${modalTitle}</div>
          <div class="status-modal-copy">${modalCopy}</div>
          <div class="status-option-row">
            ${statusOptions
              .map((status) => {
                const selected = selectedStatusId === status.id;
                return `
                  <button class="status-option ${selected ? 'selected' : ''}" data-building-status-id="${status.id}">
                    <span class="status-option-glyph">${status.iconGlyph}</span>
                    <span class="status-option-name">${status.statusName}</span>
                    <span class="status-option-tooltip">${status.description}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
          <div class="status-modal-actions">
            <button id="cancelBuildingStatusBtn" class="ability-cancel-btn">Cancel</button>
            <button id="confirmBuildingStatusBtn" class="ability-confirm-btn" ${
              selectedStatusId ? '' : 'disabled'
            }>Confirm</button>
          </div>
        </div>
      </div>
    `;
  } else if (state.mode === 'foundation_confirm') {
    const targetBuilding =
      state.pendingFoundationTargetBuildingId
        ? getBuildingById(currentPlayer.id, state.pendingFoundationTargetBuildingId)
        : null;
    const targetName = targetBuilding ? getBuildingDisplayName(targetBuilding) : 'this building';
    overlayEl.innerHTML = `
      <div class="overlay-backdrop">
        <div class="status-modal">
          <div class="status-modal-title">Foundation</div>
          <div class="status-modal-copy">Do you agree to destroy ${targetName}?</div>
          <div class="status-modal-actions">
            <button id="cancelFoundationBtn" class="ability-cancel-btn">Cancel</button>
            <button id="confirmFoundationBtn" class="ability-confirm-btn">Confirm</button>
          </div>
        </div>
      </div>
    `;
  } else {
    overlayEl.innerHTML = '';
  }

  handEl.querySelectorAll<HTMLButtonElement>('.hand-panel .card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const handIndex = Number.parseInt(btn.dataset.handIndex!, 10);
      const clickedCard = currentPlayer.hand[handIndex];
      const clickedTemplate = clickedCard ? CARD_LIBRARY[clickedCard.cardId] : null;
      if (!clickedTemplate) {
        return;
      }

      if (state.mode === 'harvest_absorb') {
        if (state.selectedCardHandIndex === handIndex) {
          clearSelection();
          renderUI();
          return;
        }
        dispatch({
          type: 'PLAY_HARVEST_DATA_ABSORB',
          sourceHandIndex: state.selectedCardHandIndex!,
          targetHandIndex: handIndex,
        });
        return;
      }

      if (clickedTemplate.id === CARD_LIBRARY.HARVEST_DATA.id) {
        state.mode = 'harvest_absorb';
        state.selectedCardHandIndex = handIndex;
        state.selectedUnitId = null;
        state.coreMagnetPreviewUnitId = null;
        state.repairTargetingCasterId = null;
        state.placingBuildingType = null;
        syncBoardVisualState();
        renderUI();
        return;
      }

      if (clickedTemplate.id === CARD_LIBRARY.SYSTEM_SHOCK.id) {
        if (state.mode === 'system_shock_card' && state.selectedCardHandIndex === handIndex) {
          clearSelection();
          syncBoardVisualState();
          renderUI();
          return;
        }
        state.mode = 'system_shock_card';
        state.selectedCardHandIndex = handIndex;
        state.selectedUnitId = null;
        state.coreMagnetPreviewUnitId = null;
        state.repairTargetingCasterId = null;
        state.systemShockCasterId = null;
        state.pendingSystemShockLevel = null;
        state.pendingSystemShockSourceSlot = null;
        state.pendingShieldingLevel = null;
        state.pendingShieldingSourceSlot = null;
        state.pendingShimmeringLevel = null;
        state.pendingShimmeringSourceSlot = null;
        state.pendingShimmeringSquares = [];
        state.placingBuildingType = null;
        syncBoardVisualState();
        renderUI();
        return;
      }

      if (clickedTemplate.id === CARD_LIBRARY.SHIELDING.id) {
        if (state.mode === 'shielding_card' && state.selectedCardHandIndex === handIndex) {
          clearSelection();
          syncBoardVisualState();
          renderUI();
          return;
        }
        state.mode = 'shielding_card';
        state.selectedCardHandIndex = handIndex;
        state.selectedUnitId = null;
        state.coreMagnetPreviewUnitId = null;
        state.repairTargetingCasterId = null;
        state.systemShockCasterId = null;
        state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = null;
        syncBoardVisualState();
        renderUI();
        return;
      }

      if (clickedTemplate.id === CARD_LIBRARY.SHIMMERING_CLOAK.id) {
        if (state.mode === 'shimmering_card' && state.selectedCardHandIndex === handIndex) {
          clearSelection();
          syncBoardVisualState();
          renderUI();
          return;
        }
        state.mode = 'shimmering_card';
        state.selectedCardHandIndex = handIndex;
        state.selectedUnitId = null;
        state.coreMagnetPreviewUnitId = null;
        state.repairTargetingCasterId = null;
        state.systemShockCasterId = null;
        state.pendingSystemShockLevel = null;
        state.pendingSystemShockSourceSlot = null;
        state.pendingShieldingLevel = null;
        state.pendingShieldingSourceSlot = null;
        state.pendingShimmeringLevel = null;
        state.pendingShimmeringSourceSlot = null;
        state.pendingShimmeringSquares = [];
        state.placingBuildingType = null;
        syncBoardVisualState();
        renderUI();
        return;
      }

      state.mode = 'play_card';
      state.selectedCardHandIndex = handIndex;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = null;
      syncBoardVisualState();
      renderUI();
    });
  });

  overlayEl.querySelectorAll<HTMLButtonElement>('[data-building-status-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const statusId = btn.getAttribute('data-building-status-id') as StatusId | null;
      if (!statusId) {
        return;
      }
      if (state.mode === 'armory_status_pick') {
        state.pendingArmoryStatusId = statusId;
      } else if (state.mode === 'replicator_status_pick') {
        state.pendingReplicatorStatusId = statusId;
      } else if (state.mode === 'workshop_status_pick') {
        state.pendingWorkshopStatusId = statusId;
      } else if (state.mode === 'datacenter_status_pick') {
        state.pendingDatacenterStatusId = statusId;
      } else if (state.mode === 'gear_station_status_pick') {
        state.pendingGearStationStatusId = statusId;
      } else if (state.mode === 'assembly_line_status_pick') {
        state.pendingAssemblyLineStatusId = statusId;
      } else if (state.mode === 'building_upgrade_status_pick') {
        state.pendingUpgradeStatusId = statusId;
      }
      renderUI();
    });
  });

  const cancelBuildingStatusBtn = overlayEl.querySelector('#cancelBuildingStatusBtn');
  if (cancelBuildingStatusBtn) {
    cancelBuildingStatusBtn.addEventListener('click', () => {
      if (state.mode === 'building_upgrade_status_pick') {
        state.mode = 'idle';
        state.pendingUpgradeBuildingId = null;
        state.pendingUpgradeStatusId = null;
        state.pendingUpgradeStatusOptions = [];
      } else {
        state.mode = 'place_building';
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
      renderUI();
    });
  }

  const confirmBuildingStatusBtn = overlayEl.querySelector('#confirmBuildingStatusBtn');
  if (confirmBuildingStatusBtn) {
    confirmBuildingStatusBtn.addEventListener('click', () => {
      const placement = readBuildingPlacementFromState();
      if (placement) {
        dispatch({
          type: 'CONFIRM_BUILDING_PLACEMENT',
          buildingType: placement.buildingType,
          squareKey: placement.squareKey,
          statusId: placement.statusId,
        });
        return;
      }
      if (state.mode === 'building_upgrade_status_pick') {
        const buildingId = state.pendingUpgradeBuildingId;
        const statusId = state.pendingUpgradeStatusId;
        if (buildingId && statusId) {
          dispatch({ type: 'CONFIRM_BUILDING_UPGRADE', buildingId, statusId });
        }
      }
    });
  }

  const cancelFoundationBtn = overlayEl.querySelector('#cancelFoundationBtn');
  if (cancelFoundationBtn) {
    cancelFoundationBtn.addEventListener('click', () => {
      state.mode = 'idle';
      state.pendingFoundationTargetBuildingId = null;
      renderUI();
    });
  }

  const confirmFoundationBtn = overlayEl.querySelector('#confirmFoundationBtn');
  if (confirmFoundationBtn) {
    confirmFoundationBtn.addEventListener('click', () => {
      const targetBuildingId = state.pendingFoundationTargetBuildingId;
      if (!targetBuildingId) return;
      dispatch({ type: 'FOUNDATION_CONFIRM', targetBuildingId });
    });
  }

  const buildCardArmory = handEl.querySelector('#buildCardArmory');
  if (buildCardArmory) {
    buildCardArmory.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.ARMORY.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardReplicator = handEl.querySelector('#buildCardReplicator');
  if (buildCardReplicator) {
    buildCardReplicator.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.REPLICATOR.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardWorkshop = handEl.querySelector('#buildCardWorkshop');
  if (buildCardWorkshop) {
    buildCardWorkshop.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.WORKSHOP.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardDatacenter = handEl.querySelector('#buildCardDatacenter');
  if (buildCardDatacenter) {
    buildCardDatacenter.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.DATACENTER.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardGearStation = handEl.querySelector('#buildCardGearStation');
  if (buildCardGearStation) {
    buildCardGearStation.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.GEAR_STATION.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardAssemblyLine = handEl.querySelector('#buildCardAssemblyLine');
  if (buildCardAssemblyLine) {
    buildCardAssemblyLine.addEventListener('click', () => {
      state.mode = 'place_building';
      state.selectedCardHandIndex = null;
      state.selectedUnitId = null;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.overloadTargetingBuildingId = null;
      state.systemShockCasterId = null;
      state.pendingSystemShockLevel = null;
      state.pendingSystemShockSourceSlot = null;
      state.pendingShieldingLevel = null;
      state.pendingShieldingSourceSlot = null;
      state.pendingShimmeringLevel = null;
      state.pendingShimmeringSourceSlot = null;
      state.pendingShimmeringSquares = [];
      state.placingBuildingType = BUILD_CARD_LIBRARY.ASSEMBLY_LINE.id;
      state.pendingArmorySquareKey = null;
      state.pendingArmoryStatusId = null;
      state.pendingArmoryDraftStatusIds = [];
      state.pendingReplicatorSquareKey = null;
      state.pendingReplicatorStatusId = null;
      state.pendingWorkshopSquareKey = null;
      state.pendingWorkshopStatusId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const buildCardFoundation = handEl.querySelector('#buildCardFoundation');
  if (buildCardFoundation) {
    buildCardFoundation.addEventListener('click', () => {
      activateFoundationTargeting();
    });
  }

  // Map data-attribute → (ability slot for ACTIVATE_BUILDING). The 'production'
  // ability is implicit for the Armory/Replicator/Workshop main button; the
  // *-create-id variants on Datacenter/Gear Station/Assembly Line are the
  // building's secondary "produce a card" slot, which still maps to the same
  // 'production' ability in the reducer (the engine routes by building.type).
  const wireBuildingAbility = (selector: string, ability: 'production' | 'overload' | 'obtain' | 'draw' | 'upgrade', attr: string): void => {
    handEl.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.addEventListener('click', () => {
        const buildingId = btn.getAttribute(attr);
        if (!buildingId) return;
        dispatch({ type: 'ACTIVATE_BUILDING', buildingId, ability });
      });
    });
  };

  wireBuildingAbility('[data-armory-id]', 'production', 'data-armory-id');
  wireBuildingAbility('[data-replicator-id]', 'production', 'data-replicator-id');
  wireBuildingAbility('[data-workshop-id]', 'production', 'data-workshop-id');
  wireBuildingAbility('[data-datacenter-id]', 'obtain', 'data-datacenter-id');
  wireBuildingAbility('[data-gear-station-id]', 'overload', 'data-gear-station-id');
  wireBuildingAbility('[data-assembly-line-id]', 'draw', 'data-assembly-line-id');
  wireBuildingAbility('[data-datacenter-create-id]', 'production', 'data-datacenter-create-id');
  wireBuildingAbility('[data-gear-station-create-id]', 'production', 'data-gear-station-create-id');
  wireBuildingAbility('[data-assembly-line-create-id]', 'production', 'data-assembly-line-create-id');
  wireBuildingAbility('[data-upgrade-building-id]', 'upgrade', 'data-upgrade-building-id');

  const tacticalDashButton = handEl.querySelector('#abilityTacticalDash');
  if (tacticalDashButton) {
    tacticalDashButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId) {
        return;
      }
      dispatch({ type: 'ACTIVATE_TACTICAL_DASH', unitId: unit.id });
    });
  }

  const attackButton = handEl.querySelector('#abilityAttack');
  if (attackButton) {
    attackButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId) {
        return;
      }
      if (isUnitMovementStunned(unit)) {
        logHint('This Drone is Dazzled and cannot attack this turn.');
        return;
      }
      const tankFaceEaterCooldown = getTankFaceEaterAttackCooldown(unit);
      if (tankFaceEaterCooldown > 0) {
        logHint(`Face-Eater attack cooldown: ${tankFaceEaterCooldown} turn(s) remaining.`);
        return;
      }
      if (unit.unitTypeId === 'ARTILLERY_UNIT') {
        if (!unit.artillerySetUpActive) {
          logHint('Artillery needs Set Up status before attacking.');
          return;
        }
        state.mode = 'artillery_attack_targeting';
      } else {
        state.mode = 'attack_targeting';
      }
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      state.systemShockCasterId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const coreMagnetButton = handEl.querySelector('#abilityCoreMagnet');
  if (coreMagnetButton) {
    coreMagnetButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'TANK_DRONE_UNIT') {
        return;
      }
      if (isUnitMovementStunned(unit)) {
        logHint('This Drone is Dazzled and cannot use abilities this turn.');
        return;
      }
      const beacon = hasBeaconCoreMagnet(unit);
      if (!beacon && unit.coreMagnetTurnsLeft > 0) {
        logHint('Core Magnet is already active on this Tank Drone.');
        return;
      }
      if (!beacon && unit.coreMagnetCooldown > 0) {
        logHint('Core Magnet is on cooldown.');
        return;
      }
      if (beacon && unit.coreMagnetTurnsLeft > 0) {
        dispatch({ type: 'ACTIVATE_CORE_MAGNET', unitId: unit.id });
        return;
      }
      state.coreMagnetPreviewUnitId = unit.id;
      if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id)) {
        state.mode = 'core_magnet_bulwark_targeting';
      } else {
        state.mode = 'unit_selected';
      }
      state.hoverSquareKey = null;
      state.coreMagnetBulwarkTargetSquareKey = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const confirmCoreMagnet = handEl.querySelector('#confirmCoreMagnet');
  if (confirmCoreMagnet) {
    confirmCoreMagnet.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.id !== state.coreMagnetPreviewUnitId) {
        return;
      }
      if (unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id)) {
        logHint('Bulwark Core Magnet is activated by choosing an adjacent square.');
        return;
      }
      dispatch({ type: 'ACTIVATE_CORE_MAGNET', unitId: unit.id });
    });
  }

  const cancelCoreMagnet = handEl.querySelector('#cancelCoreMagnet');
  if (cancelCoreMagnet) {
    cancelCoreMagnet.addEventListener('click', () => {
      state.coreMagnetPreviewUnitId = null;
      state.coreMagnetBulwarkTargetSquareKey = null;
      if (state.mode === 'core_magnet_bulwark_targeting') {
        state.mode = 'unit_selected';
      }
      syncBoardVisualState();
      renderUI();
    });
  }

  const repairButton = handEl.querySelector('#abilityRepair');
  if (repairButton) {
    repairButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId || !casterHasRepairAbility(unit)) {
        return;
      }
      activateRepairTargeting(unit);
    });
  }

  const ghostbladeTeleportButton = handEl.querySelector('#abilityGhostbladeTeleport');
  if (ghostbladeTeleportButton) {
    ghostbladeTeleportButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'GHOSTBLADE_UNIT') {
        return;
      }
      if (unit.ghostbladeTeleportCooldown > 0) {
        logHint('Teleport is on cooldown.');
        return;
      }
      if (getCurrentPlayer().energy < 10) {
        logHint('Not enough Energy to use Teleport.');
        return;
      }
      state.mode = 'ghostblade_teleport_targeting';
      state.ghostbladeTeleportCasterId = unit.id;
      state.coreMagnetPreviewUnitId = null;
      state.repairTargetingCasterId = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  const artillerySetUpButton = handEl.querySelector('#abilityArtillerySetUp');
  if (artillerySetUpButton) {
    artillerySetUpButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'ARTILLERY_UNIT') {
        return;
      }
      dispatch({ type: 'ACTIVATE_ARTILLERY_SETUP', unitId: unit.id });
    });
  }

  const specialistEmpButton = handEl.querySelector('#abilitySpecialistEmp');
  if (specialistEmpButton) {
    specialistEmpButton.addEventListener('click', () => {
      const unit = getSelectedUnit();
      if (!unit || unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'SPECIALIST_UNIT') {
        return;
      }
      if (unit.specialistEmpCooldown > 0) {
        logHint('EMP is on cooldown.');
        return;
      }
      if (hasSalvoEmpStatus(unit) && (unit.specialistEmpUsesThisTurn ?? 0) >= 2) {
        logHint('Salvo: this Specialist already used EMP twice this turn.');
        return;
      }
      if (unit.hasAttacked && !hasSalvoEmpStatus(unit)) {
        logHint('Specialist cannot use EMP after attacking this turn.');
        return;
      }
      if (getCurrentPlayer().energy < 5) {
        logHint('Not enough Energy to use EMP.');
        return;
      }
      state.mode = 'specialist_emp_targeting';
      state.specialistEmpCasterId = unit.id;
      state.hoverSquareKey = null;
      syncBoardVisualState();
      renderUI();
    });
  }

  renderProcessEchoPanels(currentPlayer);

  renderSelectedUnitSideStats(selectedUnit);
  syncBoardVisualState();
}

export function renderProcessEchoPanels(currentPlayer: Player): void {
  const panelConfigs: { playerId: PlayerId; panel: HTMLElement | null }[] = [
    { playerId: 'A', panel: document.getElementById('processEchoLeft') },
    { playerId: 'B', panel: document.getElementById('processEchoRight') }
  ];
  const orderedSlots: ProcessEchoSlot[] = ['X', '1', '2', '3'];

  for (const { playerId, panel } of panelConfigs) {
    if (!panel) {
      continue;
    }
    const echo = state.players[playerId].processEcho ?? createEmptyProcessEcho();
    state.players[playerId].processEcho = echo;
    const buttons = panel.querySelectorAll<HTMLButtonElement>('.process-echo-btn');
    buttons.forEach((btn: HTMLButtonElement, index: number) => {
      const slot = orderedSlots[index];
      if (!slot) {
        return;
      }
      const slotCard = echo[slot];
      const hasCard = Boolean(slotCard);
      const tooltipHtml = slotCard ? getProcessEchoPerkTooltipHtml(slotCard) : '';
      btn.innerHTML = hasCard
        ? `
          <span class="process-echo-slot-label">${slot}</span>
          ${getProcessEchoCardIconHtml(slotCard)}
          ${tooltipHtml}
        `
        : `<span class="process-echo-empty-label">${slot}</span>`;
      btn.classList.toggle('filled', hasCard);
      btn.disabled = false;
      btn.onclick = () => {
        if (state.winner || playerId !== state.currentPlayerId) {
          return;
        }

        if (slot === 'X') {
          if (state.mode !== 'system_shock_card' && state.mode !== 'shielding_card' && state.mode !== 'shimmering_card') {
            logHint('Cards in X cannot be played this turn unless the card says otherwise.');
            return;
          }
          if (state.selectedCardHandIndex === null) {
            logHint('Select a storable Perk card first.');
            return;
          }
          const selectedCard = currentPlayer.hand[state.selectedCardHandIndex];
          if (
            !selectedCard ||
            (selectedCard.cardId !== CARD_LIBRARY.SYSTEM_SHOCK.id &&
              selectedCard.cardId !== CARD_LIBRARY.SHIELDING.id &&
              selectedCard.cardId !== CARD_LIBRARY.SHIMMERING_CLOAK.id)
          ) {
            logHint('Select a storable Perk card first.');
            return;
          }
          dispatch({
            type: 'PROCESS_ECHO_STORE',
            slot: 'X',
            handIndex: state.selectedCardHandIndex,
          });
          return;
        }

        if (!hasCard) {
          logHint(`Process Echo slot ${slot} is empty.`);
          return;
        }
        if (currentPlayer.processEchoPlayedThisTurn) {
          logHint('You can play only one card from Process Echo per turn.');
          return;
        }
        const level = Number.parseInt(slot, 10);
        if (!Number.isFinite(level) || level < 1 || level > 3) {
          logHint('This Process Echo slot is not playable yet.');
          return;
        }
        if (!slotCard) {
          return;
        }
        if (slotCard.cardId === CARD_LIBRARY.SYSTEM_SHOCK.id) {
          state.mode = 'system_shock_targeting_echo';
          state.pendingSystemShockLevel = level;
          state.pendingSystemShockSourceSlot = slot;
          state.pendingShieldingLevel = null;
          state.pendingShieldingSourceSlot = null;
          state.pendingShimmeringLevel = null;
          state.pendingShimmeringSourceSlot = null;
          state.pendingShimmeringSquares = [];
        } else if (slotCard.cardId === CARD_LIBRARY.SHIELDING.id) {
          state.mode = 'shielding_equip_echo';
          state.pendingShieldingLevel = level;
          state.pendingShieldingSourceSlot = slot;
          state.pendingSystemShockLevel = null;
          state.pendingSystemShockSourceSlot = null;
          state.pendingShimmeringLevel = null;
          state.pendingShimmeringSourceSlot = null;
          state.pendingShimmeringSquares = [];
        } else if (slotCard.cardId === CARD_LIBRARY.SHIMMERING_CLOAK.id) {
          state.mode = 'shimmering_targeting_echo';
          state.pendingShimmeringLevel = level;
          state.pendingShimmeringSourceSlot = slot;
          state.pendingShimmeringSquares = [];
          state.pendingSystemShockLevel = null;
          state.pendingSystemShockSourceSlot = null;
          state.pendingShieldingLevel = null;
          state.pendingShieldingSourceSlot = null;
        } else {
          logHint('This Process Echo card cannot be played.');
          return;
        }
        state.selectedCardHandIndex = null;
        state.selectedUnitId = null;
        state.systemShockCasterId = null;
        state.coreMagnetPreviewUnitId = null;
        state.repairTargetingCasterId = null;
        syncBoardVisualState();
        renderUI();
      };
    });
  }
}

export function getProcessEchoPerkTooltipHtml(card: Card): string {
  const cardTemplate = CARD_LIBRARY[card.cardId];
  if (!cardTemplate) {
    return '';
  }
  if (cardTemplate.id === CARD_LIBRARY.SYSTEM_SHOCK.id) {
    return `
      <span class="process-echo-tooltip">
        <strong>System Shock</strong><br/>
        Target rule: enemy must be within attack range of at least one of your drones.<br/>
        Level 1: Deal 5 SYSTEM damage to an enemy drone.<br/>
        Level 2: Deal 8 SYSTEM damage to an enemy drone.<br/>
        Level 3: Deal 8 SYSTEM damage; if target is destroyed, gain 10 Energy.
      </span>
    `;
  }
  if (cardTemplate.id === CARD_LIBRARY.SHIELDING.id) {
    return `
      <span class="process-echo-tooltip">
        <strong>Shielding</strong><br/>
        Level 1: Add 2 Shield to your drone.<br/>
        Level 2: Add 5 Shield to your drone.<br/>
        Level 3: Add 5 Shield and stack with current Shield value.
      </span>
    `;
  }
  if (cardTemplate.id === CARD_LIBRARY.SHIMMERING_CLOAK.id) {
    return `
      <span class="process-echo-tooltip">
        <strong>Shimmering Cloak</strong><br/>
        Level 1: 1 Square for 1 Turn.<br/>
        Level 2: 1 Square for 2 Turns.<br/>
        Level 3: 2 Squares for 2 Turns.
      </span>
    `;
  }
  return `
    <span class="process-echo-tooltip">
      <strong>${cardTemplate.cardName}</strong><br/>
      Perk card in Process Echo.
    </span>
  `;
}

export function getProcessEchoCardIconHtml(card: Card | null): string {
  if (!card) {
    return '';
  }
  if (card.cardId === CARD_LIBRARY.SYSTEM_SHOCK.id) {
    return `
      <span class="process-echo-system-shock" aria-hidden="true">
        <span class="palm">\uD83D\uDD90</span>
        <span class="bolt">\u26A1</span>
      </span>
    `;
  }
  if (card.cardId === CARD_LIBRARY.SHIELDING.id) {
    return `
      <span class="process-echo-system-shock process-echo-icon-blue" aria-hidden="true">
        <span class="palm">\uD83D\uDEE1\uFE0F</span>
      </span>
    `;
  }
  if (card.cardId === CARD_LIBRARY.SHIMMERING_CLOAK.id) {
    return `
      <span class="process-echo-system-shock process-echo-icon-blue" aria-hidden="true">
        <span class="palm">\uD83E\uDDE5</span>
      </span>
    `;
  }
  return `
    <span class="process-echo-system-shock" aria-hidden="true">
      <span class="palm">\u2728</span>
    </span>
  `;
}

export function renderSelectedUnitSideStats(selectedUnit: Unit | null): void {
  droneStatsLeftEl.innerHTML = '';
  droneStatsRightEl.innerHTML = '';
  droneStatsLeftEl.classList.remove('visible');
  droneStatsRightEl.classList.remove('visible');

  if (!selectedUnit) {
    return;
  }

  normalizeEnergizeSystemDamage(selectedUnit);
  const effectiveMove = getUnitCurrentMoveRange(selectedUnit);
  const effectiveAttackRange = getUnitCurrentAttackRange(selectedUnit);
  const effectiveAttackDamage = getUnitCurrentAttackDamage(selectedUnit);
  const damageType = selectedUnit.damageType ?? DAMAGE_TYPES.ATTACK;
  const shieldBonus = selectedUnit.shieldHitPoints ?? 0;
  const additionalSystemDamage = Math.max(0, selectedUnit.additionalSystemDamagePerAttack ?? 0);
  const statsHtml = `
    <div class="drone-stats-card ${selectedUnit.owner === 'A' ? 'a' : 'b'}">
      <div class="drone-stats-title">${selectedUnit.unitName}</div>
      <div class="drone-stats-row">Movement: <strong>${effectiveMove}</strong></div>
      <div class="drone-stats-row">Attack: <strong>${effectiveAttackDamage}</strong></div>
      <div class="drone-stats-row">Range: <strong>${effectiveAttackRange}</strong></div>
      <div class="drone-stats-row">Damage Type: <strong>${damageType}</strong></div>
      ${additionalSystemDamage > 0 ? `<div class="drone-stats-row">Additional Damage: <strong>${additionalSystemDamage} System Damage</strong></div>` : ''}
      ${shieldBonus > 0 ? `<div class="drone-stats-row">Shield: <strong>${shieldBonus}/${shieldBonus}</strong></div>` : ''}
      <div class="drone-stats-row">Hit Points: <strong>${selectedUnit.hitPoints}/${selectedUnit.maxHitPoints}</strong></div>
    </div>
  `;

  if (selectedUnit.owner === 'A') {
    droneStatsLeftEl.innerHTML = statsHtml;
    droneStatsLeftEl.classList.add('visible');
  } else {
    droneStatsRightEl.innerHTML = statsHtml;
    droneStatsRightEl.classList.add('visible');
  }
}
