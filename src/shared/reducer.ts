/**
 * applyAction — the single entry point for all player intents.
 *
 * Stage A status: this reducer is a thin dispatch table over the existing
 * engine functions. It validates "is this action even structurally possible"
 * and routes to the correct engine handler. The engine functions still own
 * the deeper game-rule validation (energy cost, range, cooldown, etc.) and
 * silently fail (with a LOG event) when called illegally.
 *
 * Stage C will tighten this: the reducer will reject illegal actions up
 * front with a typed error, and the server will use that to ack/reject.
 *
 * For now most action handlers are TODO stubs. The point of this file in
 * Stage A is to establish the contract; input handlers will be migrated
 * to dispatch through it incrementally.
 */

import type { Action } from './actions.ts';
import type { GameEvent } from './events.ts';
import type { PlayerId } from '../types.ts';
import { state } from '../state.ts';
import { fromSquareKey } from '../utils.ts';

// Engine entry points
import { endTurn as engineEndTurn } from '../engine/turnManager.ts';
import {
  applyUnitAttack,
  applyBaseAttack,
  summonUnit,
  executeUnitMove,
} from '../engine/combat.ts';
import {
  activateTacticalDash,
  activateCoreMagnet,
  activateBulwarkCoreMagnet,
  activateArtillerySetUp,
  applyRepairAbility,
  applyShimmeringCloakSelection,
  executeHarvestDataAbsorb,
  executeGhostbladeTeleport,
  executeShielding,
  executeProcessEchoStore,
  executeSystemShock,
  executeSpecialistEmp,
} from '../engine/abilities.ts';
import {
  executeArtilleryBallisticAgainstUnit,
  executeArtilleryBallisticAgainstBase,
  executeArtilleryGauss,
  executeArtilleryArea,
  getGaussLineSquareKeysFromTarget,
  getArtilleryAreaSquareKeys,
} from '../engine/artillery.ts';
import {
  executeConfirmBuildingPlacement,
  executePlayBuildCard,
  executeCancelBuildingPlacement,
  executeConfirmBuildingUpgrade,
  executeActivateBuilding,
  executeGearStationOverloadTarget,
  executeFoundationConfirm,
} from '../engine/buildings.ts';
import { CARD_LIBRARY } from '../data/cardLibrary.ts';
import { setEnergy } from '../engine/playerResources.ts';
import { getCardEnergyCost } from '../engine/cards.ts';

export interface ReduceResult {
  ok: true;
  events: GameEvent[];
}

export interface ReduceError {
  ok: false;
  error: string;
  events: GameEvent[];
}

/**
 * Run an action through the engine and return the events it produced.
 *
 * Important: at Stage A the engine still mutates the global `state` singleton
 * in-place. The events returned from this function describe what *just*
 * happened. In Stage B/C the server will call this with an explicit state
 * argument and the function will return a new immutable state.
 */
export function applyAction(action: Action): ReduceResult | ReduceError {
  switch (action.type) {
    case 'END_TURN':
      engineEndTurn();
      // Events emitted during the engine call live in the shared buffer
      // and are drained on a microtask by the configured sink (DOM applier
      // on the client, broadcaster on the server in Stage C). We do NOT
      // drain here — that would race the microtask sink and lose events.
      return { ok: true, events: [] };

    // ---------------------------------------------------------------------
    // The remaining action handlers are intentionally not wired yet.
    // Input handlers will be migrated to dispatch through this reducer
    // incrementally (Stage A.9+, Stage C). Until then they call the engine
    // directly, which still emits events the same way.
    // ---------------------------------------------------------------------
    case 'MOVE_UNIT': {
      const unit = state.units.find((u) => u.id === action.unitId);
      if (!unit) return { ok: false, error: 'unit_not_found', events: [] };
      const target = fromSquareKey(action.targetSquareKey);
      executeUnitMove(unit, target.x, target.z);
      return { ok: true, events: [] };
    }

    case 'ATTACK_UNIT': {
      const attacker = state.units.find((u) => u.id === action.attackerId);
      const target = state.units.find((u) => u.id === action.targetUnitId);
      if (!attacker || !target) return { ok: false, error: 'unit_not_found', events: [] };
      applyUnitAttack(attacker, target);
      return { ok: true, events: [] };
    }

    case 'ATTACK_BASE': {
      const attacker = state.units.find((u) => u.id === action.attackerId);
      if (!attacker) return { ok: false, error: 'unit_not_found', events: [] };
      applyBaseAttack(attacker, action.baseOwner, action.targetSquareKey);
      return { ok: true, events: [] };
    }

    case 'PLAY_UNIT_CARD': {
      const player = state.players[state.currentPlayerId];
      const card = player.hand[action.handIndex];
      if (!card) return { ok: false, error: 'card_not_in_hand', events: [] };
      const template = CARD_LIBRARY[card.cardId] as { energyCost: number; summonUnitId?: string };
      if (!template?.summonUnitId) {
        return { ok: false, error: 'not_a_unit_card', events: [] };
      }
      const cost = getCardEnergyCost(card);
      setEnergy(player, player.energy - cost);
      player.hand.splice(action.handIndex, 1);
      player.discard.push(card);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summonUnit(player.id, action.targetSquareKey, template.summonUnitId as any, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(card.adjacencyBonuses ? (card.adjacencyBonuses as any) : {}),
        grantedStatusIds: card.grantedStatusIds ?? [],
      });
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_TACTICAL_DASH': {
      const unit = state.units.find((u) => u.id === action.unitId);
      if (!unit) return { ok: false, error: 'unit_not_found', events: [] };
      activateTacticalDash(unit);
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_CORE_MAGNET': {
      const unit = state.units.find((u) => u.id === action.unitId);
      if (!unit) return { ok: false, error: 'unit_not_found', events: [] };
      activateCoreMagnet(unit);
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_BULWARK_CORE_MAGNET': {
      const unit = state.units.find((u) => u.id === action.unitId);
      if (!unit) return { ok: false, error: 'unit_not_found', events: [] };
      activateBulwarkCoreMagnet(unit, action.centerSquareKey);
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_ARTILLERY_SETUP': {
      const unit = state.units.find((u) => u.id === action.unitId);
      if (!unit) return { ok: false, error: 'unit_not_found', events: [] };
      activateArtillerySetUp(unit);
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_REPAIR': {
      const caster = state.units.find((u) => u.id === action.casterUnitId);
      const target = state.units.find((u) => u.id === action.targetUnitId);
      if (!caster || !target) return { ok: false, error: 'unit_not_found', events: [] };
      applyRepairAbility(caster, target);
      return { ok: true, events: [] };
    }

    case 'GHOSTBLADE_TELEPORT': {
      const caster = state.units.find((u) => u.id === action.casterUnitId);
      if (!caster) return { ok: false, error: 'unit_not_found', events: [] };
      executeGhostbladeTeleport(caster, action.targetSquareKey);
      return { ok: true, events: [] };
    }

    case 'ARTILLERY_FIRE': {
      const artillery = state.units.find((u) => u.id === action.unitId);
      if (!artillery) return { ok: false, error: 'unit_not_found', events: [] };
      if (action.mode === 'ballistic') {
        if (action.targetUnitId) {
          const target = state.units.find((u) => u.id === action.targetUnitId);
          if (!target) return { ok: false, error: 'unit_not_found', events: [] };
          executeArtilleryBallisticAgainstUnit(artillery, target);
        } else if (action.targetSquareKey) {
          const owner: PlayerId = artillery.owner === 'A' ? 'B' : 'A';
          executeArtilleryBallisticAgainstBase(artillery, owner, action.targetSquareKey);
        } else {
          return { ok: false, error: 'ballistic_target_missing', events: [] };
        }
      } else if (action.mode === 'gauss') {
        if (!action.targetSquareKey) return { ok: false, error: 'gauss_target_missing', events: [] };
        const lineKeys = getGaussLineSquareKeysFromTarget(artillery, action.targetSquareKey);
        if (lineKeys.length === 0) return { ok: false, error: 'gauss_invalid_line', events: [] };
        executeArtilleryGauss(artillery, lineKeys);
      } else if (action.mode === 'standard') {
        if (!action.targetSquareKey) return { ok: false, error: 'area_target_missing', events: [] };
        const areaKeys = getArtilleryAreaSquareKeys(action.targetSquareKey);
        executeArtilleryArea(artillery, areaKeys);
      }
      return { ok: true, events: [] };
    }

    case 'PLAY_SHIMMERING_CLOAK': {
      // Level is determined by the source (hand=instant=1, echo carries pendingShimmeringLevel).
      // The engine fn reads source via state.mode; the action carries squareKeys explicitly.
      const level = state.mode === 'shimmering_targeting_instant'
        ? 1
        : Math.max(1, Math.min(3, state.pendingShimmeringLevel ?? 1));
      applyShimmeringCloakSelection(level, action.squareKeys);
      return { ok: true, events: [] };
    }

    case 'PLAY_HARVEST_DATA_ABSORB': {
      executeHarvestDataAbsorb(action.sourceHandIndex, action.targetHandIndex);
      return { ok: true, events: [] };
    }

    case 'PLAY_SHIELDING': {
      const target = state.units.find((u) => u.id === action.targetUnitId);
      if (!target) return { ok: false, error: 'unit_not_found', events: [] };
      const sourceArg =
        action.source === 'hand'
          ? { source: 'hand' as const, handIndex: action.handIndex }
          : { source: 'echo' as const, slot: action.slot };
      executeShielding(target, sourceArg);
      return { ok: true, events: [] };
    }

    case 'PROCESS_ECHO_STORE': {
      executeProcessEchoStore(action.handIndex, action.slot);
      return { ok: true, events: [] };
    }

    case 'PLAY_SYSTEM_SHOCK': {
      const target = state.units.find((u) => u.id === action.targetUnitId);
      if (!target) return { ok: false, error: 'unit_not_found', events: [] };
      const sourceArg =
        action.source === 'hand'
          ? { source: 'hand' as const, handIndex: action.handIndex }
          : { source: 'echo' as const, slot: action.slot };
      executeSystemShock(target, sourceArg);
      return { ok: true, events: [] };
    }

    case 'SPECIALIST_EMP': {
      const specialist = state.units.find((u) => u.id === action.casterUnitId);
      if (!specialist) return { ok: false, error: 'unit_not_found', events: [] };
      const areaKeys = getArtilleryAreaSquareKeys(action.centerSquareKey);
      executeSpecialistEmp(specialist, areaKeys);
      return { ok: true, events: [] };
    }

    case 'PLAY_BUILD_CARD': {
      executePlayBuildCard(action.buildingType, action.targetSquareKey);
      return { ok: true, events: [] };
    }

    case 'CONFIRM_BUILDING_PLACEMENT': {
      executeConfirmBuildingPlacement(action.buildingType, action.squareKey, action.statusId);
      return { ok: true, events: [] };
    }

    case 'CANCEL_BUILDING_PLACEMENT': {
      executeCancelBuildingPlacement();
      return { ok: true, events: [] };
    }

    case 'CONFIRM_BUILDING_UPGRADE': {
      executeConfirmBuildingUpgrade(action.buildingId, action.statusId);
      return { ok: true, events: [] };
    }

    case 'ACTIVATE_BUILDING': {
      executeActivateBuilding(action.buildingId, action.ability);
      return { ok: true, events: [] };
    }

    case 'GEAR_STATION_OVERLOAD_TARGET': {
      executeGearStationOverloadTarget(action.buildingId, action.targetUnitId);
      return { ok: true, events: [] };
    }

    case 'FOUNDATION_CONFIRM': {
      executeFoundationConfirm(action.targetBuildingId);
      return { ok: true, events: [] };
    }
  }
}
