import './style.css';

// --- Bridge: wire render callbacks before anything else ---
import { registerRenderUI, registerSyncBoardVisualState } from './bridge.ts';
import { renderUI, getPlayerMaxEnergy, refreshPlayerMaxEnergy } from './ui/renderUI.ts';
import { syncBoardVisualState, initBoard, initAxisLabels } from './three/boardRenderer.ts';
import { setEventSink, emit } from './shared/events.ts';
import { applyEvents } from './eventApplier.ts';

// Pure engine emits typed events; client applies them to DOM/Three.js.
setEventSink(applyEvents);

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

// --- Init & start ---
async function init() {
  initAxisLabels();
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

  startGame();
}

init();
