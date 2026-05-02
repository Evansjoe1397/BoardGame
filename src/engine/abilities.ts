import type { PlayerId, Unit, Player, Card, ProcessEchoSlot, StatusId } from '../types';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import {
  getDistance,
  getCurrentPlayer,
  getUnitById,
  clearSelection,
  canPlayerDirectlyTargetUnit
} from '../utils.ts';
import { renderUI, syncBoardVisualState, addLog } from '../shared/events.ts';
import {
  getUnitCurrentMoveRange,
  getUnitCurrentAttackRange,
  unitHasStatus,
  isUnitPlanted,
  hasBeaconCoreMagnet,
  getBulwarkAdjacentSquareKeys,
  canCoreMagnetHealThisTurn,
  markCoreMagnetHealedThisTurn,
  casterHasRepairAbility
} from './unitStats.ts';
import { getCardEnergyCost } from './cards.ts';
import { setEnergy, setSupply } from './playerResources.ts';
import { applyUnitAttack } from './combat.ts';
import { getUnitCurrentAttackDamage } from './unitStats.ts';
import { fromSquareKey } from '../utils.ts';
import { DAMAGE_TYPES } from '../constants.ts';
import { emit } from '../shared/events.ts';

// ---------------------------------------------------------------------------
// Tactical Dash (Pawn Drone)
// ---------------------------------------------------------------------------

export function activateTacticalDash(unit: Unit): void {
  if (unit.owner !== state.currentPlayerId) {
    addLog('Only your selected drone can use this ability.');
    return;
  }

  if (unit.unitTypeId !== 'PAWN_DRONE_UNIT') {
    addLog('Only Pawn Drone can use Tactical Dash.');
    return;
  }

  if (unit.tacticalDashActiveThisTurn) {
    addLog('Tactical Dash is already active on this drone.');
    return;
  }

  if (unit.tacticalDashCooldown > 0) {
    addLog('Tactical Dash is on cooldown.');
    return;
  }

  unit.tacticalDashActiveThisTurn = true;
  unit.tacticalDashCooldown = 3;
  addLog(`${unit.owner} Pawn Drone activated Tactical Dash.`);
  renderUI();
}

// ---------------------------------------------------------------------------
// Core Magnet (Tank Drone)
// ---------------------------------------------------------------------------

export function activateCoreMagnet(unit: Unit): void {
  if (unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'TANK_DRONE_UNIT') {
    addLog('Only your selected Tank Drone can use Core Magnet.');
    return;
  }

  const beacon = hasBeaconCoreMagnet(unit);
  if (!beacon && unit.coreMagnetTurnsLeft > 0) {
    addLog('Core Magnet is already active on this Tank Drone.');
    return;
  }
  if (!beacon && unit.coreMagnetCooldown > 0) {
    addLog('Core Magnet is on cooldown.');
    return;
  }

  if (!beacon && unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id)) {
    addLog('Bulwark Core Magnet requires selecting one adjacent direction square.');
    return;
  }

  if (beacon && unit.coreMagnetTurnsLeft > 0) {
    unit.coreMagnetTurnsLeft = 0;
    unit.coreMagnetBulwarkCenterSquareKey = null;
    unit.coreMagnetCooldown = 0;
    state.mode = 'unit_selected' as string as typeof state.mode;
    state.hoverSquareKey = null;
    state.coreMagnetPreviewUnitId = null;
    state.coreMagnetBulwarkTargetSquareKey = null;
    addLog(`${unit.owner} Tank Drone canceled Core Magnet (Beacon).`);
    syncBoardVisualState();
    renderUI();
    return;
  }

  unit.coreMagnetTurnsLeft = beacon ? 1 : 2;
  unit.coreMagnetCooldown = beacon ? 0 : 3;
  unit.coreMagnetBulwarkCenterSquareKey = null;
  if (!beacon || canCoreMagnetHealThisTurn(unit)) {
    unit.hitPoints = Math.min(unit.maxHitPoints, unit.hitPoints + 5);
    markCoreMagnetHealedThisTurn(unit);
  }
  if (!beacon) {
    unit.hasMoved = true;
    unit.hasAttacked = true;
    unit.movementUsedThisTurn = getUnitCurrentMoveRange(unit);
  }
  state.mode = 'unit_selected' as string as typeof state.mode;
  state.hoverSquareKey = null;
  state.coreMagnetPreviewUnitId = null;
  state.coreMagnetBulwarkTargetSquareKey = null;
  addLog(
    beacon
      ? `${unit.owner} Tank Drone activated Core Magnet (Beacon).`
      : `${unit.owner} Tank Drone activated Core Magnet and repaired 5 HP.`
  );
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Bulwark Core Magnet (Tank Drone area protection)
// ---------------------------------------------------------------------------

export function activateBulwarkCoreMagnet(unit: Unit, centerSquareKey: string): void {
  if (unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'TANK_DRONE_UNIT') {
    addLog('Only your selected Tank Drone can use Core Magnet.');
    return;
  }
  if (!unitHasStatus(unit, DRONE_STATUS_LIBRARY.BULWARK.id)) {
    addLog('This Tank Drone does not have Bulwark.');
    return;
  }
  if (unit.coreMagnetTurnsLeft > 0) {
    addLog('Core Magnet is already active on this Tank Drone.');
    return;
  }
  const beacon = hasBeaconCoreMagnet(unit);
  if (!beacon && unit.coreMagnetCooldown > 0) {
    addLog('Core Magnet is on cooldown.');
    return;
  }
  const adjacentKeys = new Set(getBulwarkAdjacentSquareKeys(unit));
  if (!adjacentKeys.has(centerSquareKey)) {
    addLog('Bulwark direction must be an adjacent square.');
    return;
  }

  unit.coreMagnetBulwarkCenterSquareKey = centerSquareKey;
  unit.coreMagnetTurnsLeft = beacon ? 1 : 2;
  unit.coreMagnetCooldown = beacon ? 0 : 3;
  if (!beacon || canCoreMagnetHealThisTurn(unit)) {
    unit.hitPoints = Math.min(unit.maxHitPoints, unit.hitPoints + 5);
    markCoreMagnetHealedThisTurn(unit);
  }
  if (!beacon) {
    unit.hasMoved = true;
    unit.hasAttacked = true;
    unit.movementUsedThisTurn = getUnitCurrentMoveRange(unit);
  }
  state.mode = 'unit_selected' as string as typeof state.mode;
  state.hoverSquareKey = null;
  state.coreMagnetPreviewUnitId = null;
  state.coreMagnetBulwarkTargetSquareKey = null;
  addLog(
    beacon
      ? `${unit.owner} Tank Drone activated Bulwark Core Magnet (Beacon).`
      : `${unit.owner} Tank Drone activated Bulwark Core Magnet and repaired 5 HP.`
  );
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Repair targeting (Support Drone)
// ---------------------------------------------------------------------------

export function activateRepairTargeting(unit: Unit): void {
  if (unit.owner !== state.currentPlayerId || !casterHasRepairAbility(unit)) {
    addLog('Only your Support Drone or Scholar Specialist can use Repair.');
    return;
  }
  const repairEnergyCost = unitHasStatus(unit, DRONE_STATUS_LIBRARY.SMART.id) ? 0 : 5;
  if (unit.repairCooldown > 0) {
    addLog('Repair is on cooldown.');
    return;
  }
  if (getCurrentPlayer().energy < repairEnergyCost) {
    addLog('Not enough Energy to use Repair.');
    return;
  }
  state.mode = 'repair_targeting';
  state.repairTargetingCasterId = unit.id;
  state.coreMagnetPreviewUnitId = null;
  state.systemShockCasterId = null;
  addLog('Select an allied drone within range to Repair.');
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Artillery Set Up
// ---------------------------------------------------------------------------

export function activateArtillerySetUp(unit: Unit | null | undefined): void {
  if (!unit || unit.owner !== state.currentPlayerId || unit.unitTypeId !== 'ARTILLERY_UNIT') {
    return;
  }
  if (unit.artillerySetUpUsedThisTurn) {
    addLog('Set Up can be used only once per turn.');
    return;
  }
  if (unit.artillerySetUpActive) {
    unit.artillerySetUpActive = false;
    unit.artillerySetUpUsedThisTurn = true;
    addLog('Artillery canceled Set Up and can move this turn.');
    syncBoardVisualState();
    renderUI();
    return;
  }
  if (unit.artillerySetUpCooldown > 0) {
    addLog('Set Up is on cooldown.');
    return;
  }
  unit.artillerySetUpActive = true;
  unit.artillerySetUpUsedThisTurn = true;
  unit.artillerySetUpCooldown = 3;
  unit.hasMoved = true;
  unit.hasAttacked = true;
  unit.movementUsedThisTurn = getUnitCurrentMoveRange(unit);
  addLog('Artillery started channeling Set Up.');
  state.mode = 'unit_selected' as string as typeof state.mode;
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Repair ability (execute)
// ---------------------------------------------------------------------------

export function applyRepairAbility(caster: Unit, target: Unit): void {
  const currentPlayer = getCurrentPlayer();
  const repairEnergyCost = unitHasStatus(caster, DRONE_STATUS_LIBRARY.SMART.id) ? 0 : 5;
  setEnergy(currentPlayer, currentPlayer.energy - repairEnergyCost);
  caster.repairCooldown = 2;
  caster.movementUsedThisTurn = getUnitCurrentMoveRange(caster);
  caster.hasMoved = true;

  const healAmount = Math.ceil(target.maxHitPoints * 0.5);
  const before = target.hitPoints;
  target.hitPoints = Math.min(target.maxHitPoints, target.hitPoints + healAmount);
  const restored = target.hitPoints - before;
  let mechaTargetBonusApplied = 0;
  let mechaSelfBonusApplied = 0;
  if (unitHasStatus(caster, DRONE_STATUS_LIBRARY.MECHA.id)) {
    mechaTargetBonusApplied = DRONE_STATUS_LIBRARY.MECHA.effects.repairBonusToTarget ?? 1;
    mechaSelfBonusApplied = DRONE_STATUS_LIBRARY.MECHA.effects.repairBonusToSelf ?? 1;
    const targetBeforeMecha = target.hitPoints;
    target.hitPoints = Math.min(target.maxHitPoints, target.hitPoints + mechaTargetBonusApplied);
    mechaTargetBonusApplied = Math.max(0, target.hitPoints - targetBeforeMecha);
    const casterBeforeMecha = caster.hitPoints;
    caster.hitPoints = Math.min(caster.maxHitPoints, caster.hitPoints + mechaSelfBonusApplied);
    mechaSelfBonusApplied = Math.max(0, caster.hitPoints - casterBeforeMecha);
  }
  let augmentedBonusApplied = 0;
  if (unitHasStatus(caster, DRONE_STATUS_LIBRARY.ENGINEER.id)) {
    augmentedBonusApplied = DRONE_STATUS_LIBRARY.ENGINEER.effects.repairAddsPermanentAttackToTarget ?? 1;
    target.attackDamage += augmentedBonusApplied;
    target.augmentedAttackBonus = (target.augmentedAttackBonus ?? 0) + augmentedBonusApplied;
  }

  state.mode = 'idle';
  state.repairTargetingCasterId = null;

  playRepairCasterAnimation(caster.id);
  playRepairTargetAnimation(target.id);
  addLog(
    `${caster.owner} ${caster.unitName} repaired ${target.unitName} for ${restored} HP.` +
      (mechaTargetBonusApplied > 0 || mechaSelfBonusApplied > 0
        ? ` Mecha bonus: +${mechaTargetBonusApplied} HP to target, +${mechaSelfBonusApplied} HP to caster.`
        : '') +
      (augmentedBonusApplied > 0 ? ` ${target.unitName} gained +${augmentedBonusApplied} ATT (Augmented).` : '')
  );

  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// System Shock targeting
// ---------------------------------------------------------------------------

export function getSystemShockTargetableEnemyUnits(playerId: PlayerId): Unit[] {
  const friendlies = state.units.filter((unit: Unit) => unit.owner === playerId);
  if (friendlies.length === 0) {
    return [];
  }
  const enemies = state.units.filter((unit: Unit) => unit.owner !== playerId);
  return enemies.filter((enemy: Unit) => {
    if (!canPlayerDirectlyTargetUnit(playerId, enemy)) {
      return false;
    }
    return friendlies.some((friendly: Unit) => {
      const range = getUnitCurrentAttackRange(friendly);
      return getDistance(friendly.x, friendly.z, enemy.x, enemy.z) <= range;
    });
  });
}

// ---------------------------------------------------------------------------
// Shielding effect
// ---------------------------------------------------------------------------

export function applyShieldingEffectToUnit(unit: Unit, level: number): void {
  const safeLevel = Math.max(1, Math.min(3, level));
  const shieldAmount = safeLevel >= 2 ? 5 : 2;
  const canStack = safeLevel >= 3;
  applyShieldToUnit(unit, shieldAmount, { allowStack: canStack });
  state.mode = 'unit_selected' as string as typeof state.mode;
  state.selectedUnitId = unit.id;
  state.selectedCardHandIndex = null;
  state.pendingShieldingLevel = null;
  state.pendingShieldingSourceSlot = null;
  state.pendingShimmeringLevel = null;
  state.pendingShimmeringSourceSlot = null;
  state.pendingShimmeringSquares = [];
  state.systemShockCasterId = null;
  const modeText = canStack ? 'stacked' : 'applied';
  addLog(`Player ${unit.owner} ${modeText} ${shieldAmount} Shield on ${unit.unitName} (Shielding Lv.${safeLevel}).`);
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Shimmering Cloak selection
// ---------------------------------------------------------------------------

export function applyShimmeringCloakSelection(level: number, squareKeys: string[]): void {
  const currentPlayer = getCurrentPlayer();
  const safeLevel = Math.max(1, Math.min(3, level));
  const turns = safeLevel >= 2 ? 2 : 1;
  const targetSquares = [...new Set(squareKeys)];

  if ((state.mode as string) === 'shimmering_targeting_instant') {
    const sourceCard = currentPlayer.hand[state.selectedCardHandIndex!];
    if (!sourceCard || sourceCard.cardId !== CARD_LIBRARY.SHIMMERING_CLOAK.id) {
      clearSelection();
      renderUI();
      return;
    }
    const cardTemplate = CARD_LIBRARY.SHIMMERING_CLOAK;
    if (currentPlayer.energy < cardTemplate.energyCost) {
      addLog(`Not enough Energy to play ${cardTemplate.cardName}.`);
      return;
    }
    setEnergy(currentPlayer, currentPlayer.energy - cardTemplate.energyCost);
    currentPlayer.hand.splice(state.selectedCardHandIndex!, 1);
    currentPlayer.discard.push(sourceCard);
  } else if ((state.mode as string) === 'shimmering_targeting_echo') {
    const slot = state.pendingShimmeringSourceSlot;
    if (!slot) {
      clearSelection();
      renderUI();
      return;
    }
    const slotCard = currentPlayer.processEcho?.[slot as ProcessEchoSlot];
    if (!slotCard || slotCard.cardId !== CARD_LIBRARY.SHIMMERING_CLOAK.id) {
      addLog('That Process Echo slot is empty.');
      clearSelection();
      renderUI();
      return;
    }
    applyProcessEchoPlayResult(currentPlayer, slot as ProcessEchoSlot);
  }

  addShimmeringCloak(currentPlayer.id, targetSquares, turns);
  addLog(
    `Player ${currentPlayer.id} cast Shimmering Cloak Level ${safeLevel} on ${targetSquares.join(', ')} for ${turns} turn(s).`
  );
  clearSelection();
  syncBoardVisualState();
  renderUI();
}

// ---------------------------------------------------------------------------
// Harvest Data Absorb
// ---------------------------------------------------------------------------

export function executeHarvestDataAbsorb(sourceIndex: number, targetIndex: number): void {
  const currentPlayer = getCurrentPlayer();
  const sourceCard = currentPlayer.hand[sourceIndex];
  const targetCard = currentPlayer.hand[targetIndex];
  if (!sourceCard || !targetCard) {
    clearSelection();
    renderUI();
    return;
  }

  if (sourceCard.cardId !== CARD_LIBRARY.HARVEST_DATA.id) {
    clearSelection();
    renderUI();
    return;
  }

  if (sourceIndex === targetIndex) {
    addLog('Select a Drone card to Absorb.');
    return;
  }

  const sourceTemplate = CARD_LIBRARY[sourceCard.cardId];
  const absorbedTemplate = CARD_LIBRARY[targetCard.cardId];
  if (!absorbedTemplate || absorbedTemplate.cardCategory !== 'Drone') {
    addLog('Harvest Data can only Absorb Drone cards.');
    return;
  }

  if (currentPlayer.energy < sourceTemplate.energyCost) {
    addLog(`Not enough Energy to use ${sourceTemplate.cardName}.`);
    return;
  }

  setEnergy(currentPlayer, currentPlayer.energy - sourceTemplate.energyCost);
  const absorbedEnergyCost = getCardEnergyCost(targetCard);
  setSupply(currentPlayer, currentPlayer.supply + absorbedEnergyCost);
  currentPlayer.hand = currentPlayer.hand.filter((_: Card, index: number) => index !== sourceIndex && index !== targetIndex);
  currentPlayer.discard.push(sourceCard);

  addLog(
    `Player ${currentPlayer.id} used Harvest Data: absorbed ${absorbedTemplate.cardName} and gained ${absorbedEnergyCost} Supply.`
  );
  clearSelection();
  renderUI();
}

// ---------------------------------------------------------------------------
// Late-bound imports (functions still in main.js or future modules)
// These are set via registerAbilityDeps() called from main.js during init.
// ---------------------------------------------------------------------------

interface AbilityDeps {
  playRepairCasterAnimation?: (casterId: string) => void;
  playRepairTargetAnimation?: (targetId: string) => void;
  applyShieldToUnit?: (unit: Unit, amount: number, options?: { allowStack?: boolean }) => void;
  addShimmeringCloak?: (owner: PlayerId, squareKeys: string[], turnsLeft: number) => void;
  applyProcessEchoPlayResult?: (player: Player, slot: ProcessEchoSlot) => void;
}

let playRepairCasterAnimation: (casterId: string) => void = () => {};
let playRepairTargetAnimation: (targetId: string) => void = () => {};
let applyShieldToUnit: (unit: Unit, amount: number, options?: { allowStack?: boolean }) => void = () => {};
let addShimmeringCloak: (owner: PlayerId, squareKeys: string[], turnsLeft: number) => void = () => {};
let applyProcessEchoPlayResult: (player: Player, slot: ProcessEchoSlot) => void = () => {};

export function registerAbilityDeps(deps: AbilityDeps): void {
  if (deps.playRepairCasterAnimation) playRepairCasterAnimation = deps.playRepairCasterAnimation;
  if (deps.playRepairTargetAnimation) playRepairTargetAnimation = deps.playRepairTargetAnimation;
  if (deps.applyShieldToUnit) applyShieldToUnit = deps.applyShieldToUnit;
  if (deps.addShimmeringCloak) addShimmeringCloak = deps.addShimmeringCloak;
  if (deps.applyProcessEchoPlayResult) applyProcessEchoPlayResult = deps.applyProcessEchoPlayResult;
}

// ---------------------------------------------------------------------------
// Ghostblade teleport — extracted from inputTargeting so the input layer no
// longer mutates unit position / cooldown / player energy directly.
// ---------------------------------------------------------------------------

export function executeGhostbladeTeleport(caster: Unit, targetSquareKey: string): void {
  const target = fromSquareKey(targetSquareKey);
  const fromX = caster.x;
  const fromZ = caster.z;
  caster.x = target.x;
  caster.z = target.z;
  caster.hasMoved = true;
  caster.ghostbladeTeleportCooldown = 5;
  const player = state.players[caster.owner];
  setEnergy(player, player.energy - 10);
  emit({
    type: 'UNIT_MOVED',
    unitId: caster.id,
    fromX,
    fromZ,
    toX: target.x,
    toZ: target.z,
  });

  const ghostbladeDamage = getUnitCurrentAttackDamage(caster);
  const affected = state.units.filter(
    (unit) =>
      unit.owner !== caster.owner &&
      getDistance(target.x, target.z, unit.x, unit.z) <= 1
  );
  for (const unit of affected) {
    applyUnitAttack(caster, unit, {
      damageType: DAMAGE_TYPES.ATTACK,
      damageAmount: ghostbladeDamage,
      skipCoreMagnetRedirect: true,
    });
  }
  addLog(`${caster.owner} Ghostblade teleported to ${targetSquareKey} and dealt ${ghostbladeDamage} AoE damage.`);
}
