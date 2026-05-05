import type { PlayerId, Player, Unit, Card, ProcessEcho, ProcessEchoSlot } from '../types';
import { TURN_DRAW_COUNT, SUPPLY_HARVEST_SQUARES, SUPPLY_HARVEST_REWARD } from '../constants.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state, createEmptyProcessEcho } from '../state.ts';
import { shuffle, toSquareKey, getCurrentPlayer } from '../utils.ts';
import { renderUI, syncBoardVisualState, addLog } from '../shared/events.ts';
import {
  unitHasStatus,
  hasBeaconCoreMagnet,
  getSpecialistEmpCooldownTurns,
  awardSupplyFromDrone,
  tickShimmeringCloaksForPlayer
} from './unitStats.ts';
import { setEnergy } from './playerResources.ts';

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerTurnManagerDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface TurnManagerDeps {
  refreshPlayerMaxEnergy?: (playerId: PlayerId, sync?: boolean) => number;
  playSupplyHarvestCoins?: (unitId: string) => void;
  flashSupplyHarvested?: () => void;
}

let refreshPlayerMaxEnergy: (playerId: PlayerId, sync?: boolean) => number = () => 0;
let playSupplyHarvestCoins: (unitId: string) => void = () => {};
let flashSupplyHarvested: () => void = () => {};

export function registerTurnManagerDeps(deps: TurnManagerDeps): void {
  if (deps.refreshPlayerMaxEnergy) refreshPlayerMaxEnergy = deps.refreshPlayerMaxEnergy;
  if (deps.playSupplyHarvestCoins) playSupplyHarvestCoins = deps.playSupplyHarvestCoins;
  if (deps.flashSupplyHarvested) flashSupplyHarvested = deps.flashSupplyHarvested;
}

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------

export function startGame(): void {
  addLog('Dev mode started. Right mouse button rotates camera. Left mouse button selects cards/units/targets.');
  startTurn('A');
}

// ---------------------------------------------------------------------------
// Start turn
// ---------------------------------------------------------------------------

export function startTurn(playerId: PlayerId): void {
  if (state.winner) {
    return;
  }

  state.currentPlayerId = playerId;
  state.mode = 'idle';
  state.hoverSquareKey = null;
  state.selectedCardHandIndex = null;
  state.selectedUnitId = null;
  state.coreMagnetPreviewUnitId = null;
  state.coreMagnetBulwarkTargetSquareKey = null;
  state.repairTargetingCasterId = null;
  state.overloadTargetingBuildingId = null;
  state.systemShockCasterId = null;
  state.ghostbladeTeleportCasterId = null;
  state.specialistEmpCasterId = null;
  state.pendingSystemShockLevel = null;
  state.pendingSystemShockSourceSlot = null;
  state.pendingShieldingLevel = null;
  state.pendingShieldingSourceSlot = null;
  state.pendingShimmeringLevel = null;
  state.pendingShimmeringSourceSlot = null;
  state.pendingShimmeringSquares = [];
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
  state.pendingUpgradeBuildingId = null;
  state.pendingUpgradeStatusId = null;
  state.pendingUpgradeStatusOptions = [];
  state.pendingFoundationTargetBuildingId = null;

  const player = state.players[playerId];
  const playerMaxEnergy = refreshPlayerMaxEnergy(playerId, true);
  player.turnCounter = (player.turnCounter ?? 0) + 1;
  player.processEchoPlayedThisTurn = false;
  tickShimmeringCloaksForPlayer(playerId);
  setEnergy(player, playerMaxEnergy);
  player.buildingsPlayedThisTurn = 0;
  for (const building of player.buildings) {
    if (building.createTankDroneCooldown > 0) {
      building.createTankDroneCooldown -= 1;
    }
    if (building.createPawnDroneCooldown > 0) {
      building.createPawnDroneCooldown -= 1;
    }
    if (building.createSupportDroneCooldown > 0) {
      building.createSupportDroneCooldown -= 1;
    }
    if (building.createSpecialistCooldown > 0) {
      building.createSpecialistCooldown -= 1;
    }
    if (building.createGhostbladeCooldown > 0) {
      building.createGhostbladeCooldown -= 1;
    }
    if (building.createArtilleryCooldown > 0) {
      building.createArtilleryCooldown -= 1;
    }
    building.obtainUsedThisTurn = false;
    building.overloadUsedThisTurn = false;
  }
  if (!player.openingHandDrawn) {
    drawOpeningHand(player);
    player.openingHandDrawn = true;
  } else {
    drawCards(player, TURN_DRAW_COUNT);
  }

  state.units
    .filter((unit: Unit) => unit.owner === playerId)
    .forEach((unit: Unit) => {
      if ((unit.virusDebuffPendingTurns ?? 0) > 0) {
        unit.virusDebuffPendingTurns -= 1;
        unit.virusDebuffActiveTurns = 1;
        unit.virusAttackPenaltyActive = Math.max(unit.virusAttackPenaltyActive ?? 0, unit.virusAttackPenaltyPending ?? 0);
        unit.virusAttackPenaltyPending = 0;
      }
      if (unit.empStunPendingTurns > 0) {
        unit.empStunnedTurns = Math.max(unit.empStunnedTurns ?? 0, unit.empStunPendingTurns);
        unit.empStunPendingTurns = 0;
      }
      if (
        unit.unitTypeId === 'GHOSTBLADE_UNIT' &&
        unitHasStatus(unit, DRONE_STATUS_LIBRARY.SHELL.id) &&
        !unit.shellGuardUsedThisTurn
      ) {
        unit.shellGuardActive = true;
      }
      if (unit.unitTypeId === 'GHOSTBLADE_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.TANGO.id)) {
        unit.tangoGuardActive = false;
      }
      unit.hasMoved = false;
      unit.hasAttacked = false;
      unit.movementUsedThisTurn = 0;
      unit.tacticalDashActiveThisTurn = false;
      if (unit.coreMagnetTurnsLeft > 0 && !hasBeaconCoreMagnet(unit)) {
        unit.coreMagnetTurnsLeft -= 1;
        if (unit.coreMagnetTurnsLeft <= 0) {
          unit.coreMagnetBulwarkCenterSquareKey = null;
        }
      }
      if (unit.tacticalDashCooldown > 0) {
        unit.tacticalDashCooldown -= 1;
      }
      if (unit.coreMagnetCooldown > 0) {
        unit.coreMagnetCooldown -= 1;
      }
      if (unit.repairCooldown > 0) {
        unit.repairCooldown -= 1;
      }
      if (unit.ghostbladeTeleportCooldown > 0) {
        unit.ghostbladeTeleportCooldown -= 1;
      }
      if (unit.artillerySetUpCooldown > 0) {
        unit.artillerySetUpCooldown -= 1;
      }
      if (unit.specialistEmpCooldown > 0) {
        unit.specialistEmpCooldown -= 1;
      }
      unit.specialistEmpUsesThisTurn = 0;
      unit.specialistEmpPendingCooldown = false;
      if (unit.tankFaceEaterAttackCooldown > 0) {
        unit.tankFaceEaterAttackCooldown -= 1;
      }
      unit.artillerySetUpUsedThisTurn = false;
      unit.systemShockFollowUpReady = false;
      unit.overloadBonusMovementThisTurn = 0;
    });

  addLog(`Player ${playerId} turn begins: energy restored to ${playerMaxEnergy}, drew ${TURN_DRAW_COUNT} cards.`);
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Draw cards
// ---------------------------------------------------------------------------

export function drawCards(player: Player, count: number): void {
  for (let i = 0; i < count; i += 1) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) {
        break;
      }
      player.deck = shuffle(player.discard);
      player.discard = [];
      addLog(`Player ${player.id} shuffled discard pile back into deck.`);
    }

    const card = player.deck.pop();
    if (card) {
      player.hand.push(card);
    }
  }
}

export function drawOpeningHand(player: Player): void {
  drawCards(player, TURN_DRAW_COUNT);
}

// ---------------------------------------------------------------------------
// Process Echo
// ---------------------------------------------------------------------------

export function advanceProcessEcho(player: Player): void {
  const echo = player.processEcho;
  if (!echo) {
    player.processEcho = createEmptyProcessEcho();
    return;
  }
  let movedAny = false;
  if (!echo[3] && echo[2]) {
    echo[3] = echo[2];
    echo[2] = null;
    movedAny = true;
  }
  if (!echo[2] && echo[1]) {
    echo[2] = echo[1];
    echo[1] = null;
    movedAny = true;
  }
  if (!echo[1] && echo.X) {
    echo[1] = echo.X;
    echo.X = null;
    movedAny = true;
  }
  if (movedAny) {
    addLog(`Player ${player.id} Process Echo advanced.`);
  }
}

export function applyProcessEchoPlayResult(player: Player, playedSlot: ProcessEchoSlot): void {
  const echo = player.processEcho ?? createEmptyProcessEcho();
  player.processEcho = echo;
  const playedCard = echo[playedSlot];
  if (!playedCard) {
    return;
  }

  echo[playedSlot] = null;
  const playedLevel = Number.parseInt(playedSlot as string, 10);
  for (let slot = playedLevel - 1; slot >= 1; slot -= 1) {
    const fromKey = String(slot) as ProcessEchoSlot;
    const toKey = String(slot + 1) as ProcessEchoSlot;
    if (echo[fromKey]) {
      echo[toKey] = echo[fromKey];
      echo[fromKey] = null;
    }
  }
  if (echo.X) {
    echo['1'] = echo.X;
    echo.X = null;
  }

  if (echo.X) {
    player.discard.push(echo.X);
  }
  echo.X = playedCard;
  player.processEchoPlayedThisTurn = true;
}

// ---------------------------------------------------------------------------
// End turn
// ---------------------------------------------------------------------------

export function endTurn(): void {
  if (state.winner) {
    return;
  }

  const currentPlayer = getCurrentPlayer();
  advanceProcessEcho(currentPlayer);
  state.units
    .filter((unit: Unit) => unit.owner === currentPlayer.id)
    .forEach((unit: Unit) => {
      if (unit.unitTypeId === 'GHOSTBLADE_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.TANGO.id)) {
        unit.tangoGuardActive = true;
      }
      if ((unit.empStunnedTurns ?? 0) > 0) {
        unit.empStunnedTurns -= 1;
      }
      if ((unit.virusDebuffActiveTurns ?? 0) > 0) {
        unit.virusDebuffActiveTurns -= 1;
        if (unit.virusDebuffActiveTurns <= 0) {
          unit.virusAttackPenaltyActive = 0;
        }
      }
      if (
        unit.unitTypeId === 'SPECIALIST_UNIT' &&
        unitHasStatus(unit, DRONE_STATUS_LIBRARY.SALVO.id) &&
        unit.specialistEmpPendingCooldown &&
        unit.specialistEmpCooldown <= 0
      ) {
        unit.specialistEmpCooldown = getSpecialistEmpCooldownTurns(unit);
        unit.specialistEmpPendingCooldown = false;
      }
    });
  processSupplyHarvest(currentPlayer);
  if (currentPlayer.hand.length > 0) {
    currentPlayer.discard.push(...currentPlayer.hand);
    addLog(`Player ${currentPlayer.id} discarded ${currentPlayer.hand.length} unused card(s).`);
    currentPlayer.hand = [];
  }

  const nextPlayer: PlayerId = state.currentPlayerId === 'A' ? 'B' : 'A';
  state.mode = 'idle';
  state.hoverSquareKey = null;
  state.selectedCardHandIndex = null;
  state.selectedUnitId = null;
  state.coreMagnetPreviewUnitId = null;
  state.coreMagnetBulwarkTargetSquareKey = null;
  state.repairTargetingCasterId = null;
  state.overloadTargetingBuildingId = null;
  state.systemShockCasterId = null;
  state.ghostbladeTeleportCasterId = null;
  state.specialistEmpCasterId = null;
  state.pendingSystemShockLevel = null;
  state.pendingSystemShockSourceSlot = null;
  state.pendingShieldingLevel = null;
  state.pendingShieldingSourceSlot = null;
  state.pendingShimmeringLevel = null;
  state.pendingShimmeringSourceSlot = null;
  state.pendingShimmeringSquares = [];
  state.placingBuildingType = null;
  state.pendingArmorySquareKey = null;
  state.pendingArmoryStatusId = null;
  state.pendingArmoryDraftStatusIds = [];
  state.pendingReplicatorSquareKey = null;
  state.pendingReplicatorStatusId = null;
  state.pendingWorkshopSquareKey = null;
  state.pendingWorkshopStatusId = null;
  startTurn(nextPlayer);
}

// ---------------------------------------------------------------------------
// Supply harvest
// ---------------------------------------------------------------------------

export function processSupplyHarvest(player: Player): void {
  const harvestingUnits = state.units.filter((unit: Unit) => {
    if (unit.owner !== player.id) {
      return false;
    }
    const squareKey = toSquareKey(unit.x, unit.z);
    return SUPPLY_HARVEST_SQUARES.has(squareKey);
  });

  if (harvestingUnits.length === 0) {
    return;
  }

  let gainedSupply = 0;
  for (const unit of harvestingUnits) {
    gainedSupply += awardSupplyFromDrone(player, unit, SUPPLY_HARVEST_REWARD, 'harvest');
    playSupplyHarvestCoins(unit.id);
  }
  if (gainedSupply <= 0) {
    return;
  }
  flashSupplyHarvested();
  addLog(
    `Player ${player.id} harvested ${gainedSupply} Supply from ${harvestingUnits.length} drone(s) on yellow squares.`
  );
}
