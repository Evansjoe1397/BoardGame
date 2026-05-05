import { describe, test, expect } from 'bun:test';
import { freshGame, takeEvents } from './setup.ts';
import { startGame, startTurn, endTurn } from '../src/engine/turnManager.ts';
import { MAX_ENERGY } from '../src/constants.ts';

describe('turn cycle', () => {
  test('startGame → A is current player with full energy and starting hand', () => {
    freshGame();
    startGame();
    const state = (globalThis as { __testState: import('../src/types').GameState }).__testState;
    expect(state.currentPlayerId).toBe('A');
    expect(state.players.A.energy).toBe(MAX_ENERGY);
    expect(state.players.A.hand.length).toBeGreaterThan(0);
  });

  test('endTurn rotates the current player', () => {
    freshGame();
    startGame();
    endTurn();
    const state = (globalThis as { __testState: import('../src/types').GameState }).__testState;
    expect(state.currentPlayerId).toBe('B');
    expect(state.players.B.hand.length).toBeGreaterThan(0);
  });

  test('two endTurns return to player A', () => {
    freshGame();
    startGame();
    endTurn();
    endTurn();
    const state = (globalThis as { __testState: import('../src/types').GameState }).__testState;
    expect(state.currentPlayerId).toBe('A');
  });

  test('startTurn restores energy to max', () => {
    const state = freshGame();
    state.players.A.energy = 0;
    startTurn('A');
    expect(state.players.A.energy).toBe(MAX_ENERGY);
  });

  test('startTurn emits ENERGY_CHANGED for the active player', () => {
    freshGame();
    startGame();
    const events = takeEvents();
    const energyChanged = events.find((e) => e.type === 'ENERGY_CHANGED');
    expect(energyChanged).toBeDefined();
    expect(energyChanged?.type === 'ENERGY_CHANGED' && energyChanged.player).toBe('A');
  });
});
