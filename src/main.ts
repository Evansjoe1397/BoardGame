import './style.css';

// --- Bridge: wire render callbacks before anything else ---
import { registerRenderUI, registerSyncBoardVisualState } from './bridge.ts';
import { renderUI, getPlayerMaxEnergy, refreshPlayerMaxEnergy } from './ui/renderUI.ts';
import { syncBoardVisualState, initBoard } from './three/boardRenderer.ts';
import { setEventSink, emit } from './shared/events.ts';
import { applyEvents } from './eventApplier/index.ts';

// Pure engine emits typed events; client applies them to DOM/Three.js.
// In multiplayer we also push the resulting state to the server after every
// drained event batch — that's the "trust-the-actor" relay covering input
// handlers that haven't been migrated through the action+reducer protocol.
setEventSink((events) => {
  applyEvents(events);
  // Push to the server only when something MEANINGFUL happened. A batch
  // containing only BOARD_SYNC / UI_REFRESH is a pure re-render trigger
  // (e.g. line ~1681 of renderUI runs syncBoardVisualState at the end of
  // every render), not a state mutation — pushing those would cause an
  // infinite ping-pong because every state_snapshot the client receives
  // also calls renderUI, which emits BOARD_SYNC, which would push back.
  const meaningful = events.some((e) => e.type !== 'BOARD_SYNC' && e.type !== 'UI_REFRESH');
  if (!meaningful) return;
  if (net.getIdentity() !== null && net.isConnected()) {
    const raw = getActiveContext().state;
    const snapshot = JSON.parse(JSON.stringify(raw));
    console.log('[push]', {
      events: events.map((e) => e.type),
      current: snapshot.currentPlayerId,
      units: snapshot.units?.map((u: { id: string; x: number; z: number }) => `${u.id}@${u.x},${u.z}`),
    });
    net.pushState(snapshot, events);
  }
});

registerRenderUI(renderUI);
registerSyncBoardVisualState(syncBoardVisualState);

// --- DOM setup ---
import { initDomSetup, boardEl, endTurnBtn } from './ui/domSetup.ts';

initDomSetup();

// --- Three.js init ---
import { initThree, renderer, onResize } from './three/sceneSetup.ts';
import { animate } from './three/animation.ts';
import { preloadModels } from './three/modelLoader.ts';

// --- Dev-only: model export tool (registers window.__exportModels) ---
import './three/modelExporter.ts';

// --- Engine dep wiring ---
import { registerCombatDeps } from './engine/combat.ts';
import { registerTurnManagerDeps } from './engine/turnManager.ts';
import { registerAbilityDeps } from './engine/abilities.ts';
import { registerBuildingDeps } from './engine/buildings.ts';
import { registerInputHandlerDeps } from './input/inputHandler.ts';
import { registerInputTargetingDeps } from './input/inputTargeting.ts';

import { removeUnitShield, applyShieldToUnit, consumeSystemShockFollowUp } from './engine/unitStats.ts';
import { addShimmeringCloak } from './engine/unitStats.ts';
import { getUnitWorldPosition } from './three/effects.ts';
import { drawCards, startGame, applyProcessEchoPlayResult } from './engine/turnManager.ts';
import { dispatch } from './actionDispatcher.ts';

// Engine effect callbacks are wired to event emission (no direct Three.js
// access from the engine). Real effects run from src/eventApplier.ts when
// the buffer is drained.
registerCombatDeps({
  removeUnitShield,
  refreshPlayerMaxEnergy,
  getUnitWorldPosition,
  playRifleShot: (attackerId, targetPos) =>
    emit({ type: 'EFFECT_RIFLE_SHOT', attackerId, targetPos: { x: targetPos.x, y: targetPos.y, z: targetPos.z } }),
  playHitEffect: (unitId) => emit({ type: 'EFFECT_HIT', unitId }),
  playExplosionAt: (pos, options) =>
    emit({ type: 'EFFECT_EXPLOSION', pos: { x: pos.x, y: pos.y, z: pos.z }, options }),
});

registerTurnManagerDeps({
  refreshPlayerMaxEnergy,
  playSupplyHarvestCoins: (unitId) => emit({ type: 'EFFECT_SUPPLY_HARVEST_COINS', unitId }),
  flashSupplyHarvested: () => emit({ type: 'EFFECT_SUPPLY_HARVEST_FLASH' }),
});

registerAbilityDeps({
  playRepairCasterAnimation: (casterId) => emit({ type: 'EFFECT_REPAIR_CASTER', casterId }),
  playRepairTargetAnimation: (targetId) => emit({ type: 'EFFECT_REPAIR_TARGET', targetId }),
  applyShieldToUnit,
  addShimmeringCloak,
  applyProcessEchoPlayResult,
});

registerBuildingDeps({
  drawCards,
  refreshPlayerMaxEnergy,
  getPlayerMaxEnergy
});

registerInputHandlerDeps({
  consumeSystemShockFollowUp
});

registerInputTargetingDeps({
  getPlayerMaxEnergy
});

// --- Input handlers ---
import { onPointerDown, onPointerMove, onKeyDown, onKeyUp } from './input/inputHandler.ts';

// --- Multiplayer (network + lobby) ---
import * as net from './network/index.ts';
import { initLobby, setOfflineStartHandler } from './ui/lobby.ts';
import { state as gameState, getActiveContext } from './state.ts';
import type { GameState } from './types';

function replaceLocalStateFrom(snapshot: GameState): void {
  console.log('[snapshot received]', {
    current: snapshot.currentPlayerId,
    units: snapshot.units?.map((u) => `${u.id}@${u.x},${u.z}`),
  });
  const ctx = getActiveContext();
  ctx.state = snapshot;
  renderUI();
  syncBoardVisualState();
}

// --- Init & start ---
async function init() {
  initThree();

  // Preload .glb models (missing files are silently skipped → procedural fallback)
  await preloadModels();

  initBoard();

  // Wire up event listeners (not in initThree to avoid circular deps)
  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  endTurnBtn.addEventListener('click', () => dispatch({ type: 'END_TURN' }));
  renderer.setAnimationLoop(animate);

  // Network: events broadcast by the server are applied to the local UI/scene
  // via the same eventApplier the engine uses for its in-page emissions.
  net.onEvents((events) => applyEvents(events));
  // Server-broadcast snapshots replace the local game state wholesale.
  net.onSnapshot(replaceLocalStateFrom);

  // Always open the WebSocket. If the URL has ?room=…&pid=… we'll auto-rejoin;
  // otherwise the lobby overlay handles create/join.
  net.start();

  // The "Play offline" button on the home screen runs the game locally.
  setOfflineStartHandler(() => startGame());

  // Lobby overlay reads the URL and decides whether to show home / join /
  // waiting. It hides itself once the first state_snapshot arrives, or
  // when the user picks "Play offline".
  initLobby();
}

init();
