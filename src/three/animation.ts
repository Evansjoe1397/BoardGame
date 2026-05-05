import * as THREE from 'three';
import { getDistance } from '../utils.ts';
import { gridToWorld } from './coords.ts';
import {
  unitVisualsById,
  movementAnimations,
  clock
} from '../visualState.ts';
import { camera, controls, renderer, scene, pressedKeys } from './sceneSetup.ts';
import { updateEffects } from './effects.ts';
import type { ExtendedUnitVisual } from './unitVisuals';
import type { UnitVisual } from '../types';

export function animate(): void {
  const delta = Math.min(clock.getDelta(), 0.033);
  const elapsedTime = clock.elapsedTime;
  updateCameraWASD(delta);
  controls.update();
  updateMovementAnimations(delta);
  updateCoreMagnetDomes(elapsedTime);
  updateEffects(delta);
  renderer.render(scene, camera);
}

export function updateCoreMagnetDomes(elapsedTime: number): void {
  for (const [, visual] of unitVisualsById.entries()) {
    if (visual.coreMagnetDome && visual.coreMagnetDome.visible) {
      const pulse = 0.17 + Math.sin(elapsedTime * 5.8) * 0.06;
      (visual.coreMagnetDome.material as THREE.MeshStandardMaterial).opacity = pulse;
      visual.coreMagnetDome.rotation.y += 0.005;
    }
    if (visual.bulwarkShield && visual.bulwarkShield.visible) {
      const shieldPulse = 0.4 + Math.sin(elapsedTime * 6.8) * 0.08;
      (visual.bulwarkShield.material as THREE.MeshStandardMaterial).opacity = shieldPulse;
    }
    if (visual.shellGuardRing && visual.shellGuardRing.visible) {
      const ringPulse = 0.82 + Math.sin(elapsedTime * 8.4) * 0.16;
      (visual.shellGuardRing.material as THREE.MeshStandardMaterial).opacity = Math.max(0.62, Math.min(0.98, ringPulse));
      (visual.shellGuardRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.05 + Math.sin(elapsedTime * 6.4) * 0.28;
      const flare = 0.92 + Math.sin(elapsedTime * 9.3) * 0.06;
      visual.shellGuardRing.scale.set(flare, flare, 1);
      visual.shellGuardRing.rotation.z += 0.018;
    }
  }
}

export function updateMovementAnimations(delta: number): void {
  if (movementAnimations.size === 0) {
    return;
  }

  for (const [unitId, animation] of movementAnimations.entries()) {
    const visual = unitVisualsById.get(unitId);
    if (!visual) {
      movementAnimations.delete(unitId);
      continue;
    }

    animation.elapsed += delta;
    const t = Math.min(animation.elapsed / animation.duration, 1);
    const eased = t * (2 - t);

    const x = animation.start.x + (animation.end.x - animation.start.x) * eased;
    const z = animation.start.z + (animation.end.z - animation.start.z) * eased;
    const bob = Math.sin(t * Math.PI) * 0.12;
    const gaitPhase = t * Math.PI * 2 * (animation.stepCount + 0.35);
    applyWalkCycle(visual as unknown as ExtendedUnitVisual, gaitPhase);
    if (visual.wheel) {
      const dx = x - animation.prevX;
      const dz = z - animation.prevZ;
      const distance = Math.hypot(dx, dz);
      const wheelRadius = visual.wheelRadiusWorld ?? 0.7;
      if (distance > 0) {
        visual.wheel.rotation.z -= distance / wheelRadius;
      }
    }
    visual.root.position.set(x, (visual.baseY ?? 0.3) + bob, z);
    animation.prevX = x;
    animation.prevZ = z;

    if (t >= 1) {
      resetWalkCycle(visual as unknown as ExtendedUnitVisual);
      visual.root.position.set(animation.end.x, visual.baseY ?? 0.3, animation.end.z);
      movementAnimations.delete(unitId);
    }
  }
}

export function startUnitMoveAnimation(unitId: string, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const start = gridToWorld(fromX, fromZ);
  const end = gridToWorld(toX, toZ);
  const steps = Math.max(1, getDistance(fromX, fromZ, toX, toZ));
  movementAnimations.set(unitId, {
    start,
    end,
    elapsed: 0,
    duration: 0.2 + steps * 0.1,
    stepCount: steps,
    prevX: start.x,
    prevZ: start.z
  });
}

export function applyWalkCycle(visual: ExtendedUnitVisual, phase: number): void {
  if (!visual.walkParts?.length) {
    return;
  }
  for (const part of visual.walkParts) {
    const value = part.base + Math.sin(phase + part.offset) * part.amplitude;
    part.node.rotation[part.axis] = value;
  }
}

export function resetWalkCycle(visual: ExtendedUnitVisual): void {
  if (!visual.walkParts?.length) {
    return;
  }
  for (const part of visual.walkParts) {
    part.node.rotation[part.axis] = part.base;
  }
}

export function updateCameraWASD(delta: number): void {
  if (pressedKeys.size === 0) {
    return;
  }

  const moveSpeed = 16 * delta;
  const move = new THREE.Vector3();

  if (pressedKeys.has('KeyW')) {
    move.z -= moveSpeed;
  }
  if (pressedKeys.has('KeyS')) {
    move.z += moveSpeed;
  }
  if (pressedKeys.has('KeyA')) {
    move.x -= moveSpeed;
  }
  if (pressedKeys.has('KeyD')) {
    move.x += moveSpeed;
  }

  camera.position.add(move);
  controls.target.add(move);
}
