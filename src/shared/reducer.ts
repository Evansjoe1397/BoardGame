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

    case 'PLAY_SYSTEM_SHOCK':
    case 'PLAY_SHIELDING':
    case 'PLAY_SHIMMERING_CLOAK':
    case 'PLAY_HARVEST_DATA_STORE':
    case 'PLAY_HARVEST_DATA_ABSORB':
    case 'ACTIVATE_TACTICAL_DASH':
    case 'ACTIVATE_REPAIR':
    case 'ACTIVATE_CORE_MAGNET':
    case 'ACTIVATE_BULWARK_CORE_MAGNET':
    case 'ACTIVATE_ARTILLERY_SETUP':
    case 'ARTILLERY_FIRE':
    case 'SPECIALIST_EMP':
    case 'GHOSTBLADE_TELEPORT':
    case 'PLAY_BUILD_CARD':
    case 'CONFIRM_BUILDING_PLACEMENT':
    case 'CANCEL_BUILDING_PLACEMENT':
    case 'ACTIVATE_BUILDING':
    case 'GEAR_STATION_OVERLOAD_TARGET':
    case 'CONFIRM_BUILDING_UPGRADE':
    case 'FOUNDATION_TARGET':
    case 'FOUNDATION_CONFIRM':
    case 'PROCESS_ECHO_STORE':
      return {
        ok: false,
        error: `Action ${action.type} not yet wired through reducer; input layer still calls engine directly.`,
        events: [],
      };
  }
}
