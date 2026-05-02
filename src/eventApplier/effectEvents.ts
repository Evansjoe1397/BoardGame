/**
 * Visual effect events — "play this animation, decay this particle system."
 * Stateless from the game-state perspective, only the Three.js scene changes.
 *
 * These will eventually be subsumed by `UNIT_ATTACKED` / `UNIT_HEALED` etc.
 * carrying weaponKind / amount, with the applier choosing the right effect.
 * For now they stay as their own primitives.
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

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

export const effectEventHandlers = {
  EFFECT_RIFLE_SHOT: ((e) => {
    playRifleShot(e.attackerId, v3(e.targetPos));
  }) satisfies EventHandler<'EFFECT_RIFLE_SHOT'>,

  EFFECT_HIT: ((e) => {
    playHitEffect(e.unitId);
  }) satisfies EventHandler<'EFFECT_HIT'>,

  EFFECT_EXPLOSION: ((e) => {
    playExplosionAt(v3(e.pos), e.options);
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
