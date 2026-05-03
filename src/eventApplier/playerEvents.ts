/**
 * Player-resource events: base HP, energy, supply, max energy.
 *
 * Each handler:
 *   1. Mutates state idempotently — the acting client already has the new
 *      value, the receiving client gets it from the wire here.
 *   2. Updates the small DOM widget that shows the value (energy bar, base
 *      HP track, supply line). No full renderUI rebuild — that path is
 *      reserved for hand / building / mode changes.
 */

import type { EventHandler } from '../shared/events.ts';
import type { PlayerId } from '../types.ts';
import { state } from '../state.ts';
import { BASE_MAX_HIT_POINTS, MAX_ENERGY } from '../constants.ts';
import { pileAEl, pileBEl } from '../ui/domSetup.ts';

function updateBaseHpBar(playerId: PlayerId): void {
  const player = state.players[playerId];
  if (!player) return;
  const hp = player.baseHitPoints;
  const maxHp = Math.max(1, player.baseMaxHitPoints ?? BASE_MAX_HIT_POINTS);
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const head = document.querySelector<HTMLElement>(`.base-hp.${playerId.toLowerCase()} .base-hp-head span`);
  const fill = document.querySelector<HTMLElement>(`.base-hp.${playerId.toLowerCase()} .base-hp-fill`);
  if (head) head.textContent = String(hp);
  if (fill) fill.style.width = `${pct}%`;
}

function updateEnergyBar(): void {
  const player = state.players[state.currentPlayerId];
  if (!player) return;
  const max = player.maxEnergy ?? MAX_ENERGY;
  const pct = Math.max(0, Math.min(100, (player.energy / Math.max(1, max)) * 100));
  const head = document.querySelector<HTMLElement>('.energy-panel .energy-head span');
  const fill = document.querySelector<HTMLElement>('.energy-panel .energy-fill');
  if (head) head.textContent = `${player.energy}/${max}`;
  if (fill) fill.style.width = `${pct}%`;
}

function updateSupplyLine(playerId: PlayerId): void {
  const el = playerId === 'A' ? pileAEl : pileBEl;
  if (!el) return;
  const supplyEl = el.querySelector<HTMLElement>('[data-supply]');
  const player = state.players[playerId];
  if (supplyEl && player) supplyEl.textContent = `Supply: ${player.supply}`;
}

export const playerEventHandlers = {
  BASE_DAMAGED: ((e) => {
    const player = state.players[e.player];
    if (player) player.baseHitPoints = e.newHp;
    updateBaseHpBar(e.player);
  }) satisfies EventHandler<'BASE_DAMAGED'>,

  ENERGY_CHANGED: ((e) => {
    const player = state.players[e.player];
    if (player) player.energy = e.newEnergy;
    if (e.player === state.currentPlayerId) updateEnergyBar();
  }) satisfies EventHandler<'ENERGY_CHANGED'>,

  MAX_ENERGY_CHANGED: ((e) => {
    const player = state.players[e.player];
    if (player) player.maxEnergy = e.newMaxEnergy;
    if (e.player === state.currentPlayerId) updateEnergyBar();
  }) satisfies EventHandler<'MAX_ENERGY_CHANGED'>,

  SUPPLY_CHANGED: ((e) => {
    const player = state.players[e.player];
    if (player) player.supply = e.newSupply;
    updateSupplyLine(e.player);
  }) satisfies EventHandler<'SUPPLY_CHANGED'>,
};
