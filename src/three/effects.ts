import * as THREE from 'three';
import { TILE_SIZE, UNIT_MODEL_SCALE, UNIT_COLORS } from '../constants.ts';
import { activeEffects, effectsGroup, unitVisualsById } from '../visualState.ts';
import type { ActiveEffect } from '../visualState';
import { healPlusTexture, coinTexture } from './textures.ts';
import { centerFlashEl } from '../ui/domSetup.ts';
import { getUnitById } from '../utils.ts';
import type { PlayerId } from '../types';

export interface ExplosionOptions {
  particleCount?: number;
  duration?: number;
  speedMin?: number;
  speedMax?: number;
}

export function getUnitWorldPosition(unitId: string): THREE.Vector3 {
  const visual = unitVisualsById.get(unitId);
  if (!visual) {
    return new THREE.Vector3();
  }
  const pos = new THREE.Vector3();
  visual.root.getWorldPosition(pos);
  pos.y += 0.58 * UNIT_MODEL_SCALE;
  return pos;
}

export function getUnitHeadWorldPosition(unitId: string): THREE.Vector3 {
  const visual = unitVisualsById.get(unitId);
  if (!visual) {
    return getUnitWorldPosition(unitId);
  }

  // Use rendered bounds so the effect always starts above the current model's head/top.
  const bounds = new THREE.Box3().setFromObject(visual.root);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return new THREE.Vector3(center.x, bounds.max.y + 0.08, center.z);
}

export function playRifleShot(attackerId: string, targetPosition: THREE.Vector3): void {
  const visual = unitVisualsById.get(attackerId);
  if (!visual) {
    return;
  }

  if (!visual.muzzle || !visual.rifleMaterial) {
    return;
  }

  const rifleMaterial = visual.rifleMaterial;
  const startPos = new THREE.Vector3();
  visual.muzzle.getWorldPosition(startPos);
  const endPos = targetPosition.clone();

  const projectile = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  projectile.position.copy(startPos);
  effectsGroup.add(projectile);

  rifleMaterial.emissive.setHex(0xffbf66);
  rifleMaterial.emissiveIntensity = 0.7;

  activeEffects.push({
    duration: 0.18,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      projectile.position.lerpVectors(startPos, endPos, t);
      projectile.scale.setScalar(1 - t * 0.55);
    },
    complete() {
      effectsGroup.remove(projectile);
      rifleMaterial.emissive.setHex(0x000000);
      rifleMaterial.emissiveIntensity = 0;
    }
  });

  const startRecoil = visual.root.position.x;
  activeEffects.push({
    duration: 0.16,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = effect.elapsed / effect.duration;
      const offset = Math.sin(Math.PI * Math.min(t, 1)) * -0.16;
      visual.root.position.x = startRecoil + offset;
    },
    complete() {
      visual.root.position.x = startRecoil;
    }
  });
}

export function playHitEffect(unitId: string): void {
  const visual = unitVisualsById.get(unitId);
  if (!visual) {
    return;
  }

  const startY = visual.root.position.y;
  const baseColor = UNIT_COLORS[getUnitById(unitId)?.owner ?? 'A'];

  activeEffects.push({
    duration: 0.28,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      const bounce = Math.sin(t * Math.PI * 4) * (1 - t) * 0.14;
      visual.root.position.y = startY + bounce;
      visual.bodyMaterial.emissive.setHex(0xff4d6d);
      visual.bodyMaterial.emissiveIntensity = 0.95 * (1 - t);
    },
    complete() {
      visual.root.position.y = startY;
      visual.bodyMaterial.color.setHex(baseColor);
      visual.bodyMaterial.emissive.setHex(0x000000);
      visual.bodyMaterial.emissiveIntensity = 0;
    }
  });
}

export function playExplosionAt(position: THREE.Vector3, options: ExplosionOptions = {}): void {
  const particleCount = options.particleCount ?? 12;
  const duration = options.duration ?? 0.5;
  const speedMin = options.speedMin ?? 1.5;
  const speedMax = options.speedMax ?? 2.4;
  const particles: { mesh: THREE.Mesh; direction: THREE.Vector3; speed: number }[] = [];

  for (let i = 0; i < particleCount; i += 1) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff8c42 : 0xff4d00,
        transparent: true,
        opacity: 0.9
      })
    );

    particle.position.copy(position);
    effectsGroup.add(particle);

    const direction = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 1.2 + 0.2,
      Math.random() * 2 - 1
    ).normalize();

    particles.push({
      mesh: particle,
      direction,
      speed: speedMin + Math.random() * (speedMax - speedMin)
    });
  }

  activeEffects.push({
    duration,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);

      for (const particle of particles) {
        particle.mesh.position.addScaledVector(particle.direction, particle.speed * delta);
        particle.mesh.scale.setScalar(1 - t * 0.75);
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      }
    },
    complete() {
      for (const particle of particles) {
        effectsGroup.remove(particle.mesh);
      }
    }
  });
}

export function playArtilleryShellShot(attackerId: string, landingPos: THREE.Vector3): void {
  const visual = unitVisualsById.get(attackerId);
  if (!visual || !visual.muzzle) {
    return;
  }
  const start = new THREE.Vector3();
  visual.muzzle.getWorldPosition(start);
  const end = new THREE.Vector3(landingPos.x, 0.55, landingPos.z);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.35, metalness: 0.5 })
  );
  shell.position.copy(start);
  effectsGroup.add(shell);
  activeEffects.push({
    duration: 0.9,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      const yArc = Math.sin(Math.PI * t) * 5.2;
      const y = start.y + (end.y - start.y) * t + yArc;
      shell.position.set(x, y, z);
    },
    complete() {
      effectsGroup.remove(shell);
    }
  });
}

export function playArtilleryGaussBeam(attackerId: string, fromWorld: THREE.Vector3, toWorld: THREE.Vector3): void {
  const visual = unitVisualsById.get(attackerId);
  if (!visual) {
    return;
  }
  const start = new THREE.Vector3(fromWorld.x, 0.95, fromWorld.z);
  const end = new THREE.Vector3(toWorld.x, 0.95, toWorld.z);
  const direction = end.clone().sub(start);
  const length = Math.max(0.2, direction.length() + TILE_SIZE * 0.9);
  const center = start.clone().add(end).multiplyScalar(0.5);

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.24, length),
    new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x22d3ee,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.88
    })
  );
  beam.position.copy(center);
  beam.lookAt(end);
  effectsGroup.add(beam);

  activeEffects.push({
    duration: 0.28,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      beam.material.opacity = 0.9 * (1 - t);
      beam.material.emissiveIntensity = 1.2 + Math.sin(effect.elapsed * 36) * 0.18;
    },
    complete() {
      effectsGroup.remove(beam);
    }
  });
}

export function playTeleportBlinkAt(worldPos: THREE.Vector3, owner: PlayerId): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 1.05, 32),
    new THREE.MeshBasicMaterial({
      color: owner === 'A' ? 0x60a5fa : 0xfb7185,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(worldPos.x, 0.15, worldPos.z);
  effectsGroup.add(ring);

  activeEffects.push({
    duration: 0.35,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      ring.scale.setScalar(1 + t * 1.8);
      ring.material.opacity = 0.85 * (1 - t);
    },
    complete() {
      effectsGroup.remove(ring);
    }
  });
}

export function playSystemShockImpact(headPosition: THREE.Vector3, targetId: string): void {
  const boltMaterial = new THREE.MeshBasicMaterial({
    color: 0xb3e5ff,
    transparent: true,
    opacity: 0.95
  });
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.075, 2.2, 7), boltMaterial);
  bolt.position.copy(headPosition);
  bolt.position.y += 1.1;
  effectsGroup.add(bolt);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.44, 24),
    new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.copy(headPosition);
  halo.position.y += 0.08;
  effectsGroup.add(halo);

  activeEffects.push({
    duration: 0.24,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      bolt.material.opacity = 0.95 * (1 - t);
      bolt.scale.set(1 + t * 0.12, 1, 1 + t * 0.12);
      halo.material.opacity = 0.8 * (1 - t);
      const pulse = 1 + t * 1.6;
      halo.scale.set(pulse, pulse, pulse);
    },
    complete() {
      effectsGroup.remove(bolt);
      effectsGroup.remove(halo);
    }
  });

  playSystemShockSmoke(targetId);
}

export function playSystemShockSmoke(targetId: string): void {
  const particles: { sprite: THREE.Sprite; angle: number; radius: number; rise: number; drift: number; phase: number }[] = [];
  const particleCount = 14;
  for (let i = 0; i < particleCount; i += 1) {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0x9ca3af,
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      })
    );
    puff.scale.set(0.22 + Math.random() * 0.1, 0.22 + Math.random() * 0.1, 0.22);
    effectsGroup.add(puff);
    particles.push({
      sprite: puff,
      angle: (Math.PI * 2 * i) / particleCount,
      radius: 0.05 + Math.random() * 0.16,
      rise: 0.24 + Math.random() * 0.24,
      drift: (Math.random() - 0.5) * 0.34,
      phase: Math.random() * Math.PI * 2
    });
  }

  activeEffects.push({
    duration: 2,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      const head = getUnitHeadWorldPosition(targetId);
      for (const particle of particles) {
        const swirl = effect.elapsed * 1.35 + particle.phase;
        particle.sprite.position.set(
          head.x + Math.cos(particle.angle + swirl) * particle.radius + particle.drift * t,
          head.y + 0.05 + particle.rise * t,
          head.z + Math.sin(particle.angle + swirl) * particle.radius
        );
        const grow = 1 + t * 1.85;
        particle.sprite.scale.setScalar((0.2 + particle.radius * 0.9) * grow);
        particle.sprite.material.opacity = 0.58 * (1 - t);
      }
    },
    complete() {
      for (const particle of particles) {
        effectsGroup.remove(particle.sprite);
      }
    }
  });
}

export function playRepairCasterAnimation(casterId: string): void {
  const visual = unitVisualsById.get(casterId);
  if (!visual?.repairArms?.length) {
    return;
  }
  const repairArms = visual.repairArms;

  activeEffects.push({
    duration: 0.45,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      const lift = Math.sin(t * Math.PI);
      for (const arm of repairArms) {
        arm.node.rotation.x = arm.baseX + (arm.raiseX - arm.baseX) * lift;
      }
    },
    complete() {
      for (const arm of repairArms) {
        arm.node.rotation.x = arm.baseX;
      }
    }
  });
}

export function playRepairTargetAnimation(targetId: string): void {
  const targetPos = getUnitHeadWorldPosition(targetId);
  for (let i = 0; i < 3; i += 1) {
    const plus = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: healPlusTexture,
        transparent: true,
        depthWrite: false
      })
    );
    plus.scale.set(0.38, 0.38, 0.38);
    plus.position.set(targetPos.x + (i - 1) * 0.18, targetPos.y + 0.2 + i * 0.1, targetPos.z);
    effectsGroup.add(plus);

    const baseY = plus.position.y;
    activeEffects.push({
      duration: 0.55,
      elapsed: 0,
      update(effect, delta) {
        effect.elapsed += delta;
        const t = Math.min(effect.elapsed / effect.duration, 1);
        plus.position.y = baseY + t * 0.4;
        plus.material.opacity = 1 - t;
        plus.scale.setScalar(0.36 + t * 0.12);
      },
      complete() {
        effectsGroup.remove(plus);
      }
    });
  }
}

export function playSupplyHarvestCoins(unitId: string): void {
  const origin = getUnitHeadWorldPosition(unitId);
  const coins: { sprite: THREE.Sprite; driftX: number; driftZ: number; rise: number }[] = [];
  const coinCount = 8;
  for (let i = 0; i < coinCount; i += 1) {
    const coin = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: coinTexture,
        transparent: true,
        depthWrite: false
      })
    );
    const angle = (i / coinCount) * Math.PI * 2;
    const radius = 0.08 + Math.random() * 0.18;
    coin.position.set(
      origin.x + Math.cos(angle) * radius,
      origin.y + Math.random() * 0.25,
      origin.z + Math.sin(angle) * radius
    );
    coin.scale.set(0.26, 0.26, 0.26);
    effectsGroup.add(coin);
    coins.push({
      sprite: coin,
      driftX: (Math.random() - 0.5) * 0.7,
      driftZ: (Math.random() - 0.5) * 0.7,
      rise: 0.45 + Math.random() * 0.5
    });
  }

  activeEffects.push({
    duration: 2,
    elapsed: 0,
    update(effect, delta) {
      effect.elapsed += delta;
      const t = Math.min(effect.elapsed / effect.duration, 1);
      for (const coin of coins) {
        coin.sprite.position.x += coin.driftX * delta;
        coin.sprite.position.z += coin.driftZ * delta;
        coin.sprite.position.y += coin.rise * delta;
        coin.sprite.material.opacity = 0.9 * (1 - t);
        const pulse = 0.24 + Math.sin((effect.elapsed + coin.driftX) * 8) * 0.03;
        coin.sprite.scale.set(pulse, pulse, pulse);
      }
    },
    complete() {
      for (const coin of coins) {
        effectsGroup.remove(coin.sprite);
      }
    }
  });
}

export function flashSupplyHarvested(): void {
  if (!centerFlashEl) {
    return;
  }
  centerFlashEl.textContent = 'Supply Harvested';
  centerFlashEl.classList.remove('show');
  // Force reflow so repeated flashes still animate.
  void centerFlashEl.offsetWidth;
  centerFlashEl.classList.add('show');
  setTimeout(() => {
  centerFlashEl.classList.remove('show');
  }, 1400);
}

export function updateEffects(delta: number): void {
  for (let i = activeEffects.length - 1; i >= 0; i -= 1) {
    const effect = activeEffects[i];
    effect.update(effect, delta);

    if (effect.elapsed >= effect.duration) {
      effect.complete?.();
      activeEffects.splice(i, 1);
    }
  }
}
