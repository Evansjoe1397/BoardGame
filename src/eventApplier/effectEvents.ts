/**
 * Visual effect events — "play this animation, decay this particle system."
 * Stateless from the game-state perspective, only the Three.js scene changes.
 *
 * Positions on the wire are grid coordinates; the handler converts them
 * to world space (Three.js Vector3) on the client. The server emits the
 * exact same events for receiving clients — that's how the non-acting
 * client sees combat explosions / muzzle flashes too.
 */

import * as THREE from 'three';
import type { EventHandler } from '../shared/events.ts';
import {
  playRifleShot,
  playHitEffect,
  playExplosionAt,
  playRepairCasterAnimation,
  playRepairTargetAnimation,
  playSupplyHarvestCoins,
  flashSupplyHarvested,
} from '../three/effects.ts';
import { gridToWorld } from '../three/coords.ts';

export const effectEventHandlers = {
  EFFECT_RIFLE_SHOT: ((e) => {
    const w = gridToWorld(e.targetGridX, e.targetGridZ);
    const target = new THREE.Vector3(w.x, e.targetY ?? 0.85, w.z);
    playRifleShot(e.attackerId, target);
  }) satisfies EventHandler<'EFFECT_RIFLE_SHOT'>,

  EFFECT_HIT: ((e) => {
    playHitEffect(e.unitId);
  }) satisfies EventHandler<'EFFECT_HIT'>,

  EFFECT_EXPLOSION: ((e) => {
    const w = gridToWorld(e.gridX, e.gridZ);
    const pos = new THREE.Vector3(w.x, e.y ?? 0.5, w.z);
    playExplosionAt(pos, e.options);
  }) satisfies EventHandler<'EFFECT_EXPLOSION'>,

  EFFECT_REPAIR_CASTER: ((e) => {
    playRepairCasterAnimation(e.casterId);
  }) satisfies EventHandler<'EFFECT_REPAIR_CASTER'>,

  EFFECT_REPAIR_TARGET: ((e) => {
    playRepairTargetAnimation(e.targetId);
  }) satisfies EventHandler<'EFFECT_REPAIR_TARGET'>,

  EFFECT_SUPPLY_HARVEST_COINS: ((e) => {
    playSupplyHarvestCoins(e.unitId);
  }) satisfies EventHandler<'EFFECT_SUPPLY_HARVEST_COINS'>,

  EFFECT_SUPPLY_HARVEST_FLASH: ((_e) => {
    flashSupplyHarvested();
  }) satisfies EventHandler<'EFFECT_SUPPLY_HARVEST_FLASH'>,
};
