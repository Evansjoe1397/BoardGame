import './style.css';

import { renderUI, getPlayerMaxEnergy, refreshPlayerMaxEnergy } from './ui/renderUI.ts';
import { syncBoardVisualState, initBoard } from './three/boardRenderer.ts';
import { setEventSink, emit } from './shared/events.ts';
import { applyEvents } from './eventApplier/index.ts';

// Pure engine emits typed events; the client applier turns them into DOM /
// Three.js side-effects. The server runs the same engine code with no DOM
// and broadcasts the events; when they arrive here, the same applier draws
// them. No "trust the actor" state push anymore — the server is the only
// authority and the dispatch+reducer pipeline is the only mutation path.
setEventSink((events) => {
  applyEvents(events);
});

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
import { drawCards, applyProcessEchoPlayResult } from './engine/turnManager.ts';
import { dispatch } from './actionDispatcher.ts';

registerCombatDeps({
  removeUnitShield,
  refreshPlayerMaxEnergy,
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
import { initLobby } from './ui/lobby.ts';
import { getActiveContext } from './state.ts';
import type { GameState } from './types';

function replaceLocalStateFrom(snapshot: GameState): void {
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

  // Lobby overlay reads the URL and decides whether to show home / join /
  // waiting. It hides itself once the first state_snapshot arrives.
  initLobby();
}

init();
