/**
 * Action union — the set of player intents the client can submit.
 *
 * In single-player mode (Stage A) actions are dispatched locally through the
 * reducer. In multiplayer (Stage C) the same payloads are sent over WebSocket
 * to the server. The shape is identical; only the transport changes.
 *
 * Conventions:
 * - Each action carries enough data to be re-played server-side without any
 *   client-only context.
 * - Targeting parameters (squareKey, unitId, etc.) are inlined into the action.
 *   Targeting *modes* (the in-between states where the client highlights
 *   valid squares) are not actions — they are local UI state.
 * - Card source for stored cards is discriminated via `source: 'hand' | 'echo'`.
 */

import type { BuildingType, PlayerId, ProcessEchoSlot, StatusId } from '../types.ts';

// ---------------------------------------------------------------------------
// Card source discriminator (hand vs Process Echo slot)
// ---------------------------------------------------------------------------

export type CardSource =
  | { source: 'hand'; handIndex: number }
  | { source: 'echo'; slot: Exclude<ProcessEchoSlot, 'X'> };  // 1, 2, or 3

// ---------------------------------------------------------------------------
// Action union
// ---------------------------------------------------------------------------

export type Action =
  // --- Turn lifecycle ---
  | { type: 'END_TURN' }

  // --- Unit movement & combat ---
  | { type: 'MOVE_UNIT'; unitId: string; targetSquareKey: string }
  | { type: 'ATTACK_UNIT'; attackerId: string; targetUnitId: string }
  | { type: 'ATTACK_BASE'; attackerId: string; baseOwner: PlayerId; targetSquareKey: string }

  // --- Unit summon (PAWN_DRONE / TANK_DRONE / SUPPORT_DRONE / SPECIALIST / GHOSTBLADE / ARTILLERY) ---
  | { type: 'PLAY_UNIT_CARD'; handIndex: number; targetSquareKey: string }

  // --- Perk / ability cards ---
  | ({ type: 'PLAY_SYSTEM_SHOCK'; casterUnitId: string; targetUnitId: string } & CardSource)
  | ({ type: 'PLAY_SHIELDING'; targetUnitId: string } & CardSource)
  | ({ type: 'PLAY_SHIMMERING_CLOAK'; squareKeys: string[] } & CardSource)
  | { type: 'PLAY_HARVEST_DATA_ABSORB'; sourceHandIndex: number; targetHandIndex: number }

  // --- Unit-activated abilities ---
  | { type: 'ACTIVATE_TACTICAL_DASH'; unitId: string }
  | { type: 'ACTIVATE_REPAIR'; casterUnitId: string; targetUnitId: string }
  | { type: 'ACTIVATE_CORE_MAGNET'; unitId: string }
  | { type: 'ACTIVATE_BULWARK_CORE_MAGNET'; unitId: string; centerSquareKey: string }
  | { type: 'ACTIVATE_ARTILLERY_SETUP'; unitId: string }
  | {
      type: 'ARTILLERY_FIRE';
      unitId: string;
      mode: 'ballistic' | 'gauss' | 'standard';
      targetUnitId?: string;
      targetSquareKey?: string;
    }
  | { type: 'SPECIALIST_EMP'; casterUnitId: string; centerSquareKey: string }
  | { type: 'GHOSTBLADE_TELEPORT'; casterUnitId: string; targetSquareKey: string }

  // --- Buildings ---
  | { type: 'PLAY_BUILD_CARD'; buildingType: BuildingType; targetSquareKey: string }
  | { type: 'CONFIRM_BUILDING_PLACEMENT'; buildingType: BuildingType; squareKey: string; statusId: StatusId }
  | { type: 'CANCEL_BUILDING_PLACEMENT' }
  | {
      type: 'ACTIVATE_BUILDING';
      buildingId: string;
      ability: 'production' | 'overload' | 'obtain' | 'draw' | 'upgrade';
    }
  | { type: 'GEAR_STATION_OVERLOAD_TARGET'; buildingId: string; targetUnitId: string }
  | { type: 'CONFIRM_BUILDING_UPGRADE'; buildingId: string; statusId: StatusId }
  | { type: 'FOUNDATION_CONFIRM'; targetBuildingId: string }

  // --- Process Echo storage (only for Harvest Data into slot X; perk-card
  //     storage in slots 1/2/3 happens via PLAY_* actions with source='echo' ---
  | { type: 'PROCESS_ECHO_STORE'; slot: ProcessEchoSlot; handIndex: number };

export type ActionType = Action['type'];
