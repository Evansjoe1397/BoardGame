import * as THREE from 'three';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { state } from '../state.ts';
import { getDistance, getBaseCenterSquare } from '../utils.ts';
import { gridToWorld } from './coords.ts';
import { unitHasStatus, isUnitMovementStunned, isTangoGhostbladeArmed } from '../engine/unitStats.ts';
import { getUnitStatusBadgeSymbol, getUnitStatusBadgeTexture } from './textures.ts';
import type { Unit, PlayerId, StatusId, StatusInstance } from '../types';
import type { ExtendedUnitVisual } from './unitVisuals';

interface BoardStatusItem {
  key?: string;
  statusId?: StatusId;
  glyph?: string;
  label?: string;
  badgeColor?: number;
  iconGlyph?: string;
  iconSymbol?: string;
  statusName?: string;
}

export function collectUnitBoardStatuses(unit: Unit): BoardStatusItem[] {
  const items = [];
  if (unit?.passiveStatuses?.length) {
    const filtered =
      unit.unitTypeId === 'TANK_DRONE_UNIT'
        ? unit.passiveStatuses.filter((status) => status.statusId !== DRONE_STATUS_LIBRARY.ATAKK.id)
        : unit.passiveStatuses;
    items.push(...filtered);
  }
  if (unit?.adjacencyStatuses?.length) {
    const filtered = unit.adjacencyStatuses.filter((status: StatusInstance & { key?: string }) => status.key !== 'adj_assembly_line_cost');
    items.push(...filtered);
  }
  if (unit?.unitTypeId === 'PAWN_DRONE_UNIT' && unit.tacticalDashActiveThisTurn) {
    items.push({ key: 'tactical_dash', glyph: '&#127939;', label: '+1 Move' });
  }
  if (unit?.unitTypeId === 'TANK_DRONE_UNIT' && unit.coreMagnetTurnsLeft > 0) {
    items.push({ key: 'planted', glyph: '&#129408;', label: 'Planted' });
  }
  if (unit?.unitTypeId === 'TANK_DRONE_UNIT' && unitHasStatus(unit, DRONE_STATUS_LIBRARY.ATAKK.id)) {
    const atFullHp = unit.hitPoints >= unit.maxHitPoints;
    items.push({
      key: 'atakk_dynamic',
      glyph: DRONE_STATUS_LIBRARY.ATAKK.iconGlyph,
      label: atFullHp ? 'Atakk' : 'Atakk (Deact)'
    });
  }
  if (unit?.unitTypeId === 'ARTILLERY_UNIT' && unit.artillerySetUpActive) {
    items.push({ key: 'artillery_setup', glyph: '&#128736;', label: 'Set Up' });
  }
  if (unit && isUnitMovementStunned(unit)) {
    items.push({ key: 'dazzled', glyph: '&#9889;', label: 'Dazzled' });
  }
  if (unit && (unit.shieldHitPoints ?? 0) > 0) {
    items.push({ key: 'shield', glyph: '&#128737;&#65039;', label: 'Shield' });
  }
  if (unit && (unit.augmentedAttackBonus ?? 0) > 0) {
    items.push({ key: 'augmented', glyph: '&#9881;', label: 'Augmented' });
  }
  if (unit && ((unit.virusDebuffPendingTurns ?? 0) > 0 || (unit.virusDebuffActiveTurns ?? 0) > 0)) {
    items.push({
      key: 'virus',
      glyph: '<span style="color:#ef4444;">&#128027;&#65038;</span>',
      label: 'Virus',
      badgeColor: 0xef4444
    });
  }
  return items;
}

export function updateUnitStatusBadges(visual: ExtendedUnitVisual, unit: Unit): void {
  if (!visual || !unit) {
    return;
  }
  if (!visual.statusBadgesGroup) {
    visual.statusBadgesGroup = new THREE.Group();
    visual.root.add(visual.statusBadgesGroup);
  }
  const group = visual.statusBadgesGroup;
  while (group.children.length) {
    const child = group.children.pop();
    if (child) {
      group.remove(child);
    }
  }

  const statuses = collectUnitBoardStatuses(unit);
  if (!statuses.length) {
    group.visible = false;
    return;
  }

  const iconScale = 0.42;
  const spacing = 0.46;
  const startX = -((statuses.length - 1) * spacing) / 2;
  statuses.forEach((status, idx) => {
    const symbol = getUnitStatusBadgeSymbol(status);
    const texture = getUnitStatusBadgeTexture(symbol);
    if (!texture) {
      return;
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        color: status.badgeColor ?? 0xffffff
      })
    );
    sprite.scale.set(iconScale, iconScale, iconScale);
    sprite.position.set(startX + idx * spacing, 0, 0);
    group.add(sprite);
  });

  group.position.set(0, (visual.statusIcon?.position?.y ?? 1.7) + 0.48, 0);
  group.visible = group.children.length > 0;
}

interface BarTextureOptions {
  fillColor?: string;
  emptyColor?: string;
  borderColor?: string;
  segmentColor?: string;
}

export function createSegmentedBarTexture(currentValue: number, maxValue: number, options: BarTextureOptions = {}): THREE.CanvasTexture | null {
  const current = Math.max(0, Math.floor(currentValue ?? 0));
  const max = Math.max(1, Math.floor(maxValue ?? 1));
  const fillColor = options.fillColor ?? '#34d399';
  const emptyColor = options.emptyColor ?? 'rgba(20, 28, 38, 0.9)';
  const borderColor = options.borderColor ?? '#d7e8fb';
  const segmentColor = options.segmentColor ?? 'rgba(8, 14, 22, 0.95)';

  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 36;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const innerX = 2;
  const innerY = 6;
  const innerW = canvas.width - 4;
  const innerH = canvas.height - 12;
  const gap = Math.max(1, Math.floor(innerW / (max * 14)));
  const segW = Math.max(1, (innerW - gap * (max - 1)) / max);

  for (let i = 0; i < max; i += 1) {
    const x = Math.round(innerX + i * (segW + gap));
    const w = Math.max(1, Math.round(segW));
    ctx.fillStyle = i < current ? fillColor : emptyColor;
    ctx.fillRect(x, innerY, w, innerH);
  }

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(1.5, 5.5, canvas.width - 3, canvas.height - 11);
  ctx.strokeStyle = segmentColor;
  ctx.lineWidth = 1;
  for (let i = 1; i < max; i += 1) {
    const x = Math.round(innerX + i * (segW + gap) - gap / 2);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, innerY + 1);
    ctx.lineTo(x + 0.5, innerY + innerH - 1);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function updateUnitHealthBars(visual: ExtendedUnitVisual, unit: Unit): void {
  if (!visual || !unit) {
    return;
  }
  if (!visual.healthBarsGroup) {
    visual.healthBarsGroup = new THREE.Group();
    visual.root.add(visual.healthBarsGroup);
    visual.healthBarHp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false
      })
    );
    visual.healthBarHp.scale.set(0.9, 0.22, 1);
    visual.healthBarsGroup.add(visual.healthBarHp);

    visual.healthBarShield = new THREE.Sprite(
      new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false
      })
    );
    visual.healthBarShield.scale.set(0.9, 0.22, 1);
    visual.healthBarsGroup.add(visual.healthBarShield);
    visual.healthBarsState = {
      hp: null,
      maxHp: null,
      shield: null
    };
  }

  const healthBarsState = visual.healthBarsState!;
  const healthBarHp = visual.healthBarHp!;
  const healthBarShield = visual.healthBarShield!;

  const hpNow = Math.max(0, Math.floor(unit.hitPoints ?? 0));
  const maxHpNow = Math.max(1, Math.floor(unit.maxHitPoints ?? 1));
  if (healthBarsState.hp !== hpNow || healthBarsState.maxHp !== maxHpNow) {
    const hpTexture = createSegmentedBarTexture(hpNow, maxHpNow, {
      fillColor: '#22c55e',
      emptyColor: 'rgba(18, 24, 34, 0.95)',
      borderColor: '#d4fce3',
      segmentColor: 'rgba(6, 12, 20, 0.95)'
    });
    if (hpTexture) {
      if (healthBarHp.material.map) {
        healthBarHp.material.map.dispose();
      }
      healthBarHp.material.map = hpTexture;
      healthBarHp.material.needsUpdate = true;
    }
    healthBarsState.hp = hpNow;
    healthBarsState.maxHp = maxHpNow;
  }
  healthBarHp.position.set(0, 0, 0);
  healthBarHp.visible = true;

  const shieldValue = Math.max(0, Math.floor(unit.shieldHitPoints ?? 0));
  if (shieldValue > 0) {
    if (healthBarsState.shield !== shieldValue) {
      const shieldTexture = createSegmentedBarTexture(shieldValue, shieldValue, {
        fillColor: '#3b82f6',
        emptyColor: 'rgba(15, 25, 42, 0.9)',
        borderColor: '#bfdbfe',
        segmentColor: 'rgba(7, 13, 24, 0.95)'
      });
      if (shieldTexture) {
        if (healthBarShield.material.map) {
          healthBarShield.material.map.dispose();
        }
        healthBarShield.material.map = shieldTexture;
        healthBarShield.material.needsUpdate = true;
      }
      healthBarsState.shield = shieldValue;
    }
    healthBarShield.visible = true;
    healthBarShield.position.set(0, 0.26, 0);
  } else {
    if (healthBarsState.shield !== 0 && healthBarShield.material.map) {
      healthBarShield.material.map.dispose();
      healthBarShield.material.map = null;
      healthBarShield.material.needsUpdate = true;
    }
    healthBarsState.shield = 0;
    healthBarShield.visible = false;
  }

  visual.healthBarsGroup.position.set(0, (visual.statusIcon?.position?.y ?? 1.7) + 1.0, 0);
  visual.healthBarsGroup.visible = true;
}

export function updateUnitStatusIcon(visual: ExtendedUnitVisual, unit: Unit): void {
  if (!visual.statusIcon) {
    return;
  }
  const isRed = unit.hasMoved && unit.hasAttacked;
  const isYellow = unit.hasMoved && !unit.hasAttacked;

  if (!isRed && !isYellow) {
    visual.statusIcon.visible = false;
    return;
  }

  const mat = visual.statusIcon.material as THREE.MeshStandardMaterial;
  visual.statusIcon.visible = true;
  mat.color.setHex(isRed ? 0xef4444 : 0xfbbf24);
  mat.emissive.setHex(isRed ? 0xb91c1c : 0xf59e0b);
  mat.emissiveIntensity = isRed ? 1.15 : 0.95;
}

export function updateArtillerySetUpPose(visual: ExtendedUnitVisual, unit: Unit): void {
  const pose = visual?.setUpPose;
  if (!pose || unit.unitTypeId !== 'ARTILLERY_UNIT') {
    return;
  }
  const active = unit.artillerySetUpActive;
  pose.barrelBase.rotation.y = pose.barrelBaseDefault.ry + (active ? -0.48 : 0);
  pose.barrelBase.position.set(
    pose.barrelBaseDefault.x + (active ? -0.03 : 0),
    pose.barrelBaseDefault.y + (active ? 0.12 : 0),
    pose.barrelBaseDefault.z
  );
  pose.barrelTip.rotation.y = pose.barrelTipDefault.ry + (active ? -0.48 : 0);
  pose.barrelTip.position.set(
    pose.barrelTipDefault.x + (active ? 0.06 : 0),
    pose.barrelTipDefault.y + (active ? 0.2 : 0),
    pose.barrelTipDefault.z
  );
}

export function updateGhostbladeTangoPose(visual: ExtendedUnitVisual, unit: Unit): void {
  const pose = visual?.tangoPose;
  if (!pose || unit.unitTypeId !== 'GHOSTBLADE_UNIT') {
    return;
  }
  const active = isTangoGhostbladeArmed(unit);
  if (!active) {
    if (!pose.applied) {
      return;
    }
    const defaults = pose.defaults;
    pose.leftArm.rotation.set(defaults.leftArmRotation.x, defaults.leftArmRotation.y, defaults.leftArmRotation.z);
    pose.rightArm.rotation.set(defaults.rightArmRotation.x, defaults.rightArmRotation.y, defaults.rightArmRotation.z);
    pose.swordHilt.position.set(defaults.swordHiltPosition.x, defaults.swordHiltPosition.y, defaults.swordHiltPosition.z);
    pose.swordHilt.rotation.set(defaults.swordHiltRotation.x, defaults.swordHiltRotation.y, defaults.swordHiltRotation.z);
    pose.swordGuard.position.set(defaults.swordGuardPosition.x, defaults.swordGuardPosition.y, defaults.swordGuardPosition.z);
    pose.swordBlade.position.set(defaults.swordBladePosition.x, defaults.swordBladePosition.y, defaults.swordBladePosition.z);
    pose.applied = false;
    return;
  }

  pose.leftArm.rotation.x = -1.45;
  pose.leftArm.rotation.z = 0.12;
  pose.rightArm.rotation.x = -1.52;
  pose.rightArm.rotation.z = -0.08;
  pose.swordHilt.position.set(0.02, 1.46, 0.08);
  pose.swordHilt.rotation.set(0, 0, 0);
  pose.swordGuard.position.set(0.02, 1.6, 0.08);
  pose.swordBlade.position.set(0.02, 1.95, 0.08);
  pose.applied = true;
}

export function updateUnitFacing(visual: ExtendedUnitVisual, unit: Unit): void {
  const enemyUnits = state.units.filter((candidate) => candidate.owner !== unit.owner);

  let targetWorld = null;
  if (enemyUnits.length > 0) {
    let closestEnemy = enemyUnits[0];
    let minDistance = getDistance(unit.x, unit.z, closestEnemy.x, closestEnemy.z);

    for (let i = 1; i < enemyUnits.length; i += 1) {
      const candidate = enemyUnits[i];
      const distance = getDistance(unit.x, unit.z, candidate.x, candidate.z);
      if (distance < minDistance) {
        minDistance = distance;
        closestEnemy = candidate;
      }
    }

    targetWorld = gridToWorld(closestEnemy.x, closestEnemy.z);
  } else {
    const fallbackEnemy = unit.owner === 'A' ? 'B' : 'A';
    const baseCenter = getBaseCenterSquare(fallbackEnemy);
    if (baseCenter) {
      targetWorld = gridToWorld(baseCenter.x, baseCenter.z);
    }
  }

  if (!targetWorld) {
    return;
  }

  const unitWorld = gridToWorld(unit.x, unit.z);
  const deltaX = targetWorld.x - unitWorld.x;
  const deltaZ = targetWorld.z - unitWorld.z;
  if (Math.abs(deltaX) < 0.0001 && Math.abs(deltaZ) < 0.0001) {
    return;
  }

  visual.root.rotation.y = Math.atan2(deltaZ, deltaX) + (Math.PI * 3) / 2;
}
