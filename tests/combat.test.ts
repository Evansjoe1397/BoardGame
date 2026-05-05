import { describe, test, expect } from 'bun:test';
import { freshGame, takeEvents } from './setup.ts';
import { summonUnit, applyUnitAttack, applyBaseAttack } from '../src/engine/combat.ts';
import { startGame } from '../src/engine/turnManager.ts';
import { DAMAGE_TYPES } from '../src/constants.ts';
import type { Unit } from '../src/types';

// Square key format is `<letter><1-indexed-row>` — see WIDTH_LABELS in
// constants.ts ('ABCDEFGHIJ') and fromSquareKey() in utils.ts. Player A base
// is rows 1-2, B base is rows 17-18, summon zones sit just in front.
const A_SUMMON = 'B3';
const B_SUMMON = 'B16';
const B_BASE_SQUARE = 'B18';

function findOwnedUnit(state: ReturnType<typeof freshGame>, owner: 'A' | 'B', typeId: string): Unit {
  const u = state.units.find((unit) => unit.owner === owner && unit.unitTypeId === typeId);
  if (!u) throw new Error(`unit ${typeId} for ${owner} not found`);
  return u;
}

describe('combat', () => {
  test('attacking a drone reduces its HP and emits UNIT_DAMAGED', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    summonUnit('B', B_SUMMON, 'PAWN_DRONE_UNIT');
    takeEvents();

    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const b = findOwnedUnit(state, 'B', 'PAWN_DRONE_UNIT');
    // Pull them adjacent so the attack passes range check.
    a.x = 1; a.z = 8;
    b.x = 1; b.z = 9;
    const before = b.hitPoints;
    applyUnitAttack(a, b);
    expect(b.hitPoints).toBeLessThan(before);

    const events = takeEvents();
    expect(events.some((e) => e.type === 'UNIT_DAMAGED')).toBe(true);
  });

  test('lethal damage removes the unit and emits UNIT_DESTROYED', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    summonUnit('B', B_SUMMON, 'PAWN_DRONE_UNIT');
    takeEvents();

    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const b = findOwnedUnit(state, 'B', 'PAWN_DRONE_UNIT');
    a.x = 1; a.z = 8;
    b.x = 1; b.z = 9;
    b.hitPoints = 1;
    const targetId = b.id;
    applyUnitAttack(a, b);

    expect(state.units.find((u) => u.id === targetId)).toBeUndefined();
    expect(takeEvents().some((e) => e.type === 'UNIT_DESTROYED')).toBe(true);
  });

  test('attacker.hasAttacked is set after a successful attack', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    summonUnit('B', B_SUMMON, 'PAWN_DRONE_UNIT');
    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const b = findOwnedUnit(state, 'B', 'PAWN_DRONE_UNIT');
    a.x = 1; a.z = 8;
    b.x = 1; b.z = 9;
    expect(a.hasAttacked).toBeFalsy();
    applyUnitAttack(a, b);
    expect(a.hasAttacked).toBe(true);
  });

  test('base attack reduces the targeted base HP and emits BASE_DAMAGED', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const beforeHp = state.players.B.baseHitPoints;
    applyBaseAttack(a, 'B', B_BASE_SQUARE, DAMAGE_TYPES.ATTACK, 5);
    expect(state.players.B.baseHitPoints).toBe(beforeHp - 5);
    expect(takeEvents().some((e) => e.type === 'BASE_DAMAGED')).toBe(true);
  });

  test('SYSTEM damage to base does not reduce HP', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    const beforeHp = state.players.B.baseHitPoints;
    applyBaseAttack(a, 'B', B_BASE_SQUARE, DAMAGE_TYPES.SYSTEM, 99);
    expect(state.players.B.baseHitPoints).toBe(beforeHp);
  });

  test('killing the base sets winner', () => {
    const state = freshGame();
    startGame();
    summonUnit('A', A_SUMMON, 'PAWN_DRONE_UNIT');
    const a = findOwnedUnit(state, 'A', 'PAWN_DRONE_UNIT');
    state.players.B.baseHitPoints = 1;
    applyBaseAttack(a, 'B', B_BASE_SQUARE, DAMAGE_TYPES.ATTACK, 99);
    expect(state.winner).toBe('A');
  });
});
