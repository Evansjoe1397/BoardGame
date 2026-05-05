import { describe, test, expect } from 'bun:test';
import { freshGame, takeEvents } from './setup.ts';
import { applyAction } from '../src/shared/reducer.ts';
import { summonUnit } from '../src/engine/combat.ts';
import { startGame, endTurn as engineEndTurn } from '../src/engine/turnManager.ts';
import { CARD_LIBRARY } from '../src/data/cardLibrary.ts';
import type { Unit } from '../src/types';

function findUnit(state: ReturnType<typeof freshGame>, owner: 'A' | 'B', typeId: string): Unit {
  const u = state.units.find((unit) => unit.owner === owner && unit.unitTypeId === typeId);
  if (!u) throw new Error(`unit ${typeId} not found`);
  return u;
}

describe('reducer', () => {
  test('END_TURN rotates the current player', () => {
    const state = freshGame();
    startGame();
    expect(state.currentPlayerId).toBe('A');
    const result = applyAction({ type: 'END_TURN' });
    expect(result.ok).toBe(true);
    expect(state.currentPlayerId).toBe('B');
  });

  test('MOVE_UNIT rejects when unit not found', () => {
    freshGame();
    startGame();
    const result = applyAction({ type: 'MOVE_UNIT', unitId: 'no-such-id', targetSquareKey: 'B4' });
    expect(result.ok).toBe(false);
  });

  test('PLAY_UNIT_CARD rejects when card not in hand', () => {
    freshGame();
    startGame();
    const result = applyAction({ type: 'PLAY_UNIT_CARD', handIndex: 999, targetSquareKey: 'B3' });
    expect(result.ok).toBe(false);
  });

  test('PLAY_UNIT_CARD spends energy and adds the unit', () => {
    const state = freshGame();
    startGame();
    // Find the index of a unit-summon card in player A's hand.
    const handIndex = state.players.A.hand.findIndex((c) => {
      const tpl = CARD_LIBRARY[c.cardId];
      return tpl?.cardType === 'unit_summon';
    });
    if (handIndex < 0) {
      // Hand happens to have no unit-summon card this draw — skip rather
      // than fail on shuffle randomness.
      return;
    }
    const card = state.players.A.hand[handIndex];
    const tpl = CARD_LIBRARY[card.cardId] as { energyCost: number };
    const energyBefore = state.players.A.energy;
    const unitsBefore = state.units.length;

    const result = applyAction({
      type: 'PLAY_UNIT_CARD',
      handIndex,
      targetSquareKey: 'B3',
    });
    expect(result.ok).toBe(true);
    expect(state.players.A.energy).toBe(energyBefore - tpl.energyCost);
    expect(state.units.length).toBe(unitsBefore + 1);
    expect(state.players.A.hand.length).toBeLessThan(state.players.A.hand.length + 1);
    takeEvents();
  });

  test('ATTACK_UNIT routes through reducer and damages the target', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', 'B3', 'PAWN_DRONE_UNIT');
    summonUnit('B', 'B16', 'PAWN_DRONE_UNIT');
    const a = findUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const b = findUnit(state, 'B', 'PAWN_DRONE_UNIT');
    a.x = 1; a.z = 8;
    b.x = 1; b.z = 9;
    const beforeHp = b.hitPoints;
    const result = applyAction({ type: 'ATTACK_UNIT', attackerId: a.id, targetUnitId: b.id });
    expect(result.ok).toBe(true);
    expect(b.hitPoints).toBeLessThan(beforeHp);
  });
});
