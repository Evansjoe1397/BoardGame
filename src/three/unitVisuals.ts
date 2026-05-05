import * as THREE from 'three';
import { TILE_SIZE, UNIT_MODEL_SCALE, UNIT_COLORS } from '../constants.ts';
import { bulwarkShieldTexture } from './textures.ts';
import type { Unit } from '../types';

export interface WalkPartInternal {
  node: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  base: number;
  amplitude: number;
  offset: number;
}

export interface RepairArmInternal {
  node: THREE.Object3D;
  baseX: number;
  raiseX: number;
}

export interface SetUpPose {
  barrelBase: THREE.Mesh;
  barrelTip: THREE.Mesh;
  barrelBaseDefault: { x: number; y: number; z: number; ry: number };
  barrelTipDefault: { x: number; y: number; z: number; ry: number };
}

interface TangoPoseDefaults {
  leftArmRotation: { x: number; y: number; z: number };
  rightArmRotation: { x: number; y: number; z: number };
  swordHiltPosition: { x: number; y: number; z: number };
  swordHiltRotation: { x: number; y: number; z: number };
  swordGuardPosition: { x: number; y: number; z: number };
  swordBladePosition: { x: number; y: number; z: number };
}

export interface TangoPose {
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  swordHilt: THREE.Mesh;
  swordGuard: THREE.Mesh;
  swordBlade: THREE.Mesh;
  defaults: TangoPoseDefaults;
  applied: boolean;
}

export interface ExtendedUnitVisual {
  root: THREE.Group;
  clickableMesh: THREE.Mesh;
  bodyMaterial: THREE.MeshStandardMaterial;
  rifleMaterial: THREE.MeshStandardMaterial;
  muzzle: THREE.Object3D;
  statusIcon: THREE.Mesh;
  coreMagnetDome: THREE.Mesh | null;
  bulwarkShield?: THREE.Mesh;
  shellGuardRing?: THREE.Mesh;
  repairArms: RepairArmInternal[] | null;
  walkParts: WalkPartInternal[];
  baseY: number;
  setUpPose?: SetUpPose;
  tangoPose?: TangoPose;
  wheel?: THREE.Mesh;
  wheelRadiusWorld?: number;
  recoilX?: number;
  statusBadgesGroup?: THREE.Group;
  healthBarsGroup?: THREE.Group;
  healthBarHp?: THREE.Sprite;
  healthBarShield?: THREE.Sprite;
  healthBarsState?: { hp: number | null; maxHp: number | null; shield: number | null };
}

export function createUnitVisual(unit: Unit): ExtendedUnitVisual {
  if (unit.unitTypeId === 'ARTILLERY_UNIT') {
    return createArtilleryVisual(unit);
  }
  if (unit.unitTypeId === 'GHOSTBLADE_UNIT') {
    return createGhostbladeVisual(unit);
  }
  if (unit.unitTypeId === 'SUPPORT_DRONE_UNIT') {
    return createSupportDroneVisual(unit);
  }
  if (unit.unitTypeId === 'TANK_DRONE_UNIT') {
    return createTankDroneVisual(unit);
  }
  if (unit.unitTypeId === 'SPECIALIST_UNIT') {
    return createSpecialistDroneVisual(unit);
  }
  return createPawnDroneVisual(unit);
}

function createArtilleryVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  root.scale.setScalar(UNIT_MODEL_SCALE * 1.4);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.36,
    metalness: 0.62,
    emissive: 0x000000
  });
  bodyMat.userData = { ownerColored: true, materialName: 'bodyMaterial' };
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1f2732,
    roughness: 0.45,
    metalness: 0.7
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.62), bodyMat);
  chassis.name = 'clickable';
  chassis.position.set(0, 0.38, 0);
  chassis.castShadow = true;
  chassis.userData = { type: 'unit', unitId: unit.id };
  root.add(chassis);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 14), darkMetal);
  turret.name = 'turret';
  turret.position.set(0, 0.62, 0);
  turret.castShadow = true;
  root.add(turret);

  const barrelBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.58, 12), darkMetal);
  barrelBase.name = 'barrelBase';
  barrelBase.rotation.z = Math.PI / 2;
  barrelBase.rotation.y = -0.16;
  barrelBase.position.set(0.36, 0.8, 0);
  barrelBase.castShadow = true;
  root.add(barrelBase);

  const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 12), darkMetal);
  barrelTip.name = 'barrelTip';
  barrelTip.rotation.z = Math.PI / 2;
  barrelTip.rotation.y = -0.16;
  barrelTip.position.set(0.78, 1.0, 0);
  barrelTip.castShadow = true;
  root.add(barrelTip);

  const trackL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.16), darkMetal);
  trackL.name = 'trackLeft';
  trackL.position.set(0, 0.19, -0.31);
  trackL.castShadow = true;
  root.add(trackL);
  const trackR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.16), darkMetal);
  trackR.name = 'trackRight';
  trackR.position.set(0, 0.19, 0.31);
  trackR.castShadow = true;
  root.add(trackR);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(1.02, 1.08, 0);
  root.add(muzzle);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.48, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  return {
    root,
    clickableMesh: chassis,
    bodyMaterial: bodyMat,
    rifleMaterial: darkMetal,
    muzzle,
    statusIcon,
    coreMagnetDome: null,
    repairArms: null,
    walkParts: [],
    baseY: 0.3,
    setUpPose: {
      barrelBase,
      barrelTip,
      barrelBaseDefault: { x: barrelBase.position.x, y: barrelBase.position.y, z: barrelBase.position.z, ry: barrelBase.rotation.y },
      barrelTipDefault: { x: barrelTip.position.x, y: barrelTip.position.y, z: barrelTip.position.z, ry: barrelTip.rotation.y }
    }
  };
}

function createGhostbladeVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  root.scale.setScalar(UNIT_MODEL_SCALE * 1.35);

  const armorMaterial = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x000000
  });
  armorMaterial.userData = { ownerColored: true, materialName: 'bodyMaterial' };
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1b2430,
    roughness: 0.42,
    metalness: 0.72
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };
  const glowColor = unit.owner === 'A' ? 0x60a5fa : 0xfb7185;
  const glowMat = new THREE.MeshStandardMaterial({
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: 0.95,
    roughness: 0.12,
    metalness: 0.05
  });
  glowMat.userData = { ownerColored: false, materialName: 'glowMaterial' };

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 8, 14), armorMaterial);
  torso.name = 'clickable';
  torso.position.y = 0.82;
  torso.castShadow = true;
  torso.userData = { type: 'unit', unitId: unit.id };
  root.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.24), darkMetal);
  head.name = 'head';
  head.position.set(0, 1.26, 0.03);
  head.castShadow = true;
  root.add(head);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), glowMat);
  eyeL.name = 'eyeLeft';
  eyeL.position.set(-0.055, 1.27, 0.16);
  root.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), glowMat);
  eyeR.name = 'eyeRight';
  eyeR.position.set(0.055, 1.27, 0.16);
  root.add(eyeR);

  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.22), darkMetal);
  hip.name = 'hip';
  hip.position.set(0, 0.46, 0);
  hip.castShadow = true;
  root.add(hip);

  const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), darkMetal);
  leftThigh.name = 'walkPart_leftThigh';
  leftThigh.position.set(-0.11, 0.24, 0);
  leftThigh.castShadow = true;
  root.add(leftThigh);
  const rightThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), darkMetal);
  rightThigh.name = 'walkPart_rightThigh';
  rightThigh.position.set(0.11, 0.24, 0);
  rightThigh.castShadow = true;
  root.add(rightThigh);

  const leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.11), darkMetal);
  leftShin.name = 'walkPart_leftShin';
  leftShin.position.set(-0.11, 0.03, 0.01);
  leftShin.castShadow = true;
  root.add(leftShin);
  const rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.11), darkMetal);
  rightShin.name = 'walkPart_rightShin';
  rightShin.position.set(0.11, 0.03, 0.01);
  rightShin.castShadow = true;
  root.add(rightShin);

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 12), armorMaterial);
  leftArm.name = 'tangoPose_leftArm';
  leftArm.position.set(-0.24, 0.82, 0.08);
  leftArm.rotation.z = 0.25;
  leftArm.castShadow = true;
  root.add(leftArm);
  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 12), armorMaterial);
  rightArm.name = 'tangoPose_rightArm';
  rightArm.position.set(0.25, 0.82, 0.12);
  rightArm.rotation.z = -0.35;
  rightArm.rotation.x = -0.2;
  rightArm.castShadow = true;
  root.add(rightArm);

  const swordHilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10), darkMetal);
  swordHilt.name = 'tangoPose_swordHilt';
  swordHilt.position.set(0.4, 0.67, 0.24);
  swordHilt.rotation.z = Math.PI / 2;
  swordHilt.castShadow = true;
  root.add(swordHilt);
  const swordGuard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), darkMetal);
  swordGuard.name = 'tangoPose_swordGuard';
  swordGuard.position.set(0.29, 0.67, 0.24);
  swordGuard.castShadow = true;
  root.add(swordGuard);
  const swordBlade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.1), glowMat);
  swordBlade.name = 'tangoPose_swordBlade';
  swordBlade.position.set(0.68, 0.67, 0.24);
  swordBlade.castShadow = true;
  root.add(swordBlade);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.83, 0.67, 0.24);
  root.add(muzzle);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.95, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  const shellRingMaterial = new THREE.MeshStandardMaterial({
    color: 0xfb923c,
    emissive: 0xdc2626,
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.18,
    transparent: true,
    opacity: 0.84,
    side: THREE.DoubleSide
  });
  const shellGuardRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 16, 36), shellRingMaterial);
  shellGuardRing.name = 'shellGuardRing';
  shellGuardRing.rotation.x = Math.PI / 2;
  shellGuardRing.position.set(0, 0.94, 0);
  shellGuardRing.castShadow = false;
  shellGuardRing.visible = false;
  root.add(shellGuardRing);

  return {
    root,
    clickableMesh: torso,
    bodyMaterial: armorMaterial,
    rifleMaterial: glowMat,
    muzzle,
    statusIcon,
    shellGuardRing,
    coreMagnetDome: null,
    repairArms: null,
    walkParts: [
      { node: leftThigh, axis: 'x', base: 0, amplitude: 0.4, offset: 0 },
      { node: rightThigh, axis: 'x', base: 0, amplitude: 0.4, offset: Math.PI },
      { node: leftShin, axis: 'x', base: 0, amplitude: 0.26, offset: Math.PI },
      { node: rightShin, axis: 'x', base: 0, amplitude: 0.26, offset: 0 },
      { node: leftArm, axis: 'x', base: 0, amplitude: 0.22, offset: Math.PI },
      { node: rightArm, axis: 'x', base: -0.2, amplitude: 0.22, offset: 0 }
    ],
    tangoPose: {
      leftArm,
      rightArm,
      swordHilt,
      swordGuard,
      swordBlade,
      defaults: {
        leftArmRotation: { x: leftArm.rotation.x, y: leftArm.rotation.y, z: leftArm.rotation.z },
        rightArmRotation: { x: rightArm.rotation.x, y: rightArm.rotation.y, z: rightArm.rotation.z },
        swordHiltPosition: { x: swordHilt.position.x, y: swordHilt.position.y, z: swordHilt.position.z },
        swordHiltRotation: { x: swordHilt.rotation.x, y: swordHilt.rotation.y, z: swordHilt.rotation.z },
        swordGuardPosition: { x: swordGuard.position.x, y: swordGuard.position.y, z: swordGuard.position.z },
        swordBladePosition: { x: swordBlade.position.x, y: swordBlade.position.y, z: swordBlade.position.z }
      },
      applied: false
    },
    baseY: 0.3,
    recoilX: 0
  };
}

function createSupportDroneVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  root.scale.setScalar(UNIT_MODEL_SCALE * 1.1);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa8b8,
    roughness: 0.34,
    metalness: 0.56,
    emissive: 0x000000
  });
  frameMaterial.userData = { ownerColored: false, materialName: 'frameMaterial' };
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x36414d,
    roughness: 0.4,
    metalness: 0.7
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };
  const helmetMaterial = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.3,
    metalness: 0.48
  });
  helmetMaterial.userData = { ownerColored: true, materialName: 'bodyMaterial' };

  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.085, 16, 28), darkMetal);
  wheel.name = 'wheel';
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0, 0.405, 0);
  wheel.castShadow = true;
  root.add(wheel);

  const wheelCore = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 14), frameMaterial);
  wheelCore.name = 'wheelCore';
  wheelCore.rotation.z = Math.PI / 2;
  wheelCore.position.set(0, 0.405, 0);
  wheelCore.castShadow = true;
  root.add(wheelCore);

  const lowerBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.18, 6, 12), frameMaterial);
  lowerBody.name = 'lowerBody';
  lowerBody.position.set(0, 0.78, 0);
  lowerBody.castShadow = true;
  root.add(lowerBody);

  const frameBack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.2), darkMetal);
  frameBack.name = 'frameBack';
  frameBack.position.set(0, 0.66, -0.02);
  frameBack.castShadow = true;
  root.add(frameBack);

  const frameFront = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.12), darkMetal);
  frameFront.name = 'frameFront';
  frameFront.position.set(0.06, 0.72, 0.18);
  frameFront.castShadow = true;
  root.add(frameFront);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 6, 12), frameMaterial);
  body.name = 'clickable';
  body.position.set(0, 1.02, 0);
  body.castShadow = true;
  body.userData = {
    type: 'unit',
    unitId: unit.id
  };
  root.add(body);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.14), frameMaterial);
  chestPlate.name = 'chestPlate';
  chestPlate.position.set(0, 1.01, 0.11);
  chestPlate.castShadow = true;
  root.add(chestPlate);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), darkMetal);
  antenna.name = 'antenna';
  antenna.position.set(0.02, 1.34, -0.08);
  antenna.castShadow = true;
  root.add(antenna);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    helmetMaterial
  );
  helmet.name = 'helmet';
  helmet.position.set(0, 1.26, 0.02);
  helmet.castShadow = true;
  root.add(helmet);

  const helmetBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 20), helmetMaterial);
  helmetBrim.name = 'helmetBrim';
  helmetBrim.position.set(0, 1.16, 0.03);
  helmetBrim.castShadow = true;
  root.add(helmetBrim);

  const helmetFrontLip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.09), helmetMaterial);
  helmetFrontLip.name = 'helmetFrontLip';
  helmetFrontLip.position.set(0, 1.14, 0.13);
  helmetFrontLip.castShadow = true;
  root.add(helmetFrontLip);

  const helmetRidge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.18), helmetMaterial);
  helmetRidge.name = 'helmetRidge';
  helmetRidge.position.set(0, 1.29, 0.02);
  helmetRidge.castShadow = true;
  root.add(helmetRidge);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.05, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x8be9fd, emissive: 0x205f76, emissiveIntensity: 0.7 })
  );
  visor.name = 'visor';
  visor.position.set(0, 1.22, 0.2);
  root.add(visor);

  const armLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12), frameMaterial);
  armLeft.name = 'repairArm_left';
  armLeft.position.set(-0.2, 0.99, 0.08);
  armLeft.rotation.z = 0.75;
  armLeft.rotation.x = -0.15;
  armLeft.castShadow = true;
  root.add(armLeft);

  const armRight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12), frameMaterial);
  armRight.name = 'repairArm_right';
  armRight.position.set(0.22, 0.96, 0.08);
  armRight.rotation.z = -0.95;
  armRight.rotation.x = -0.2;
  armRight.castShadow = true;
  root.add(armRight);

  const wrenchHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 10), darkMetal);
  wrenchHandle.name = 'wrenchHandle';
  wrenchHandle.position.set(0.34, 0.9, 0.2);
  wrenchHandle.rotation.z = -1.1;
  wrenchHandle.rotation.x = 0.15;
  wrenchHandle.castShadow = true;
  root.add(wrenchHandle);

  const wrenchHead = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 10, 16, Math.PI * 1.45), darkMetal);
  wrenchHead.name = 'wrenchHead';
  wrenchHead.position.set(0.43, 0.98, 0.22);
  wrenchHead.rotation.z = 0.18;
  wrenchHead.castShadow = true;
  root.add(wrenchHead);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.34, 0.97, 0.2);
  root.add(muzzle);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.82, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  return {
    root,
    clickableMesh: body,
    bodyMaterial: frameMaterial,
    rifleMaterial: darkMetal,
    muzzle,
    statusIcon,
    coreMagnetDome: null,
    walkParts: [
      { node: armLeft, axis: 'x', base: 0, amplitude: 0.2, offset: 0 },
      { node: armRight, axis: 'x', base: 0, amplitude: 0.2, offset: Math.PI },
      { node: body, axis: 'x', base: 0, amplitude: 0.08, offset: 0 }
    ],
    repairArms: [
      { node: armLeft, baseX: armLeft.rotation.x, raiseX: -1.25 },
      { node: armRight, baseX: armRight.rotation.x, raiseX: -1.25 }
    ],
    wheel,
    wheelRadiusWorld: (0.32 + 0.085) * UNIT_MODEL_SCALE * 1.1,
    baseY: 0.0
  };
}

function createTankLeg(material: THREE.MeshStandardMaterial): THREE.Group {
  const leg = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 10), material);
  upper.name = 'legUpper';
  upper.rotation.z = Math.PI / 2;
  upper.castShadow = true;
  leg.add(upper);

  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.08), material);
  lower.name = 'legLower';
  lower.position.set(0.2, -0.08, 0);
  lower.castShadow = true;
  leg.add(lower);

  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), material);
  foot.name = 'legFoot';
  foot.position.set(0.32, -0.14, 0);
  foot.castShadow = true;
  leg.add(foot);
  return leg;
}

function createTankDroneVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  const tankScale = UNIT_MODEL_SCALE * 1.25;
  root.scale.setScalar(tankScale);

  const armorMaterial = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.35,
    metalness: 0.58,
    emissive: 0x000000
  });
  armorMaterial.userData = { ownerColored: true, materialName: 'bodyMaterial' };
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1d2730,
    roughness: 0.42,
    metalness: 0.68
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xa8bfd8,
    roughness: 0.28,
    metalness: 0.5
  });
  accentMaterial.userData = { ownerColored: false, materialName: 'accentMaterial' };

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.46, 8, 18), armorMaterial);
  torso.name = 'clickable';
  torso.rotation.z = Math.PI / 2;
  torso.position.set(0, 0.72, 0.02);
  torso.castShadow = true;
  torso.userData = {
    type: 'unit',
    unitId: unit.id
  };
  root.add(torso);

  const topShell = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.26, 0.54), armorMaterial);
  topShell.name = 'topShell';
  topShell.position.set(0, 0.88, 0.02);
  topShell.castShadow = true;
  root.add(topShell);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.2), accentMaterial);
  head.name = 'head';
  head.position.set(0.18, 0.98, 0.2);
  head.castShadow = true;
  root.add(head);

  const eyeStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x8be9fd, emissive: 0x205f76, emissiveIntensity: 0.7 })
  );
  eyeStrip.name = 'eyeStrip';
  eyeStrip.position.set(0.2, 0.98, 0.31);
  root.add(eyeStrip);

  const armLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.2), darkMetal);
  armLeft.name = 'walkPart_leftArm';
  armLeft.position.set(-0.48, 0.72, 0.08);
  armLeft.rotation.z = 0.22;
  armLeft.castShadow = true;
  root.add(armLeft);

  const armRight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.2), darkMetal);
  armRight.name = 'walkPart_rightArm';
  armRight.position.set(0.48, 0.72, 0.08);
  armRight.rotation.z = -0.22;
  armRight.castShadow = true;
  root.add(armRight);

  const muzzleMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), darkMetal);
  muzzleMount.name = 'muzzleMount';
  muzzleMount.position.set(0.38, 0.69, 0.26);
  muzzleMount.castShadow = true;
  root.add(muzzleMount);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 12), darkMetal);
  barrel.name = 'barrel';
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.66, 0.69, 0.26);
  barrel.castShadow = true;
  root.add(barrel);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.9, 0.69, 0.26);
  root.add(muzzle);

  const crabLegFL = createTankLeg(darkMetal);
  crabLegFL.name = 'walkPart_legFrontLeft';
  crabLegFL.position.set(0.28, 0.36, 0.28);
  crabLegFL.rotation.z = -0.95;
  root.add(crabLegFL);

  const crabLegFR = createTankLeg(darkMetal);
  crabLegFR.name = 'walkPart_legFrontRight';
  crabLegFR.position.set(0.28, 0.36, -0.28);
  crabLegFR.rotation.z = -0.95;
  root.add(crabLegFR);

  const crabLegBL = createTankLeg(darkMetal);
  crabLegBL.name = 'walkPart_legBackLeft';
  crabLegBL.position.set(-0.28, 0.36, 0.28);
  crabLegBL.rotation.z = 0.95;
  root.add(crabLegBL);

  const crabLegBR = createTankLeg(darkMetal);
  crabLegBR.name = 'walkPart_legBackRight';
  crabLegBR.position.set(-0.28, 0.36, -0.28);
  crabLegBR.rotation.z = 0.95;
  root.add(crabLegBR);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.8, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  const coreMagnetDome = new THREE.Mesh(
    new THREE.SphereGeometry(1.75, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: unit.owner === 'A' ? 0x57a8ff : 0xff8894,
      emissive: unit.owner === 'A' ? 0x2f72ff : 0xd73a49,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  coreMagnetDome.name = 'coreMagnetDome';
  coreMagnetDome.position.set(0, 0.25, 0);
  coreMagnetDome.visible = false;
  root.add(coreMagnetDome);

  const bulwarkShield = new THREE.Mesh(
    // Compensate for tank root scale so world-space shield matches covered board area.
    new THREE.PlaneGeometry((TILE_SIZE * 2.92) / tankScale, 3.135 / tankScale),
    new THREE.MeshStandardMaterial({
      map: bulwarkShieldTexture,
      color: unit.owner === 'A' ? 0x8fb4ff : 0xffb0b8,
      emissive: unit.owner === 'A' ? 0x3a66bf : 0xad4453,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.16,
      metalness: 0.08
    })
  );
  bulwarkShield.name = 'bulwarkShield';
  bulwarkShield.position.set(0, 1.66, 0);
  bulwarkShield.visible = false;
  root.add(bulwarkShield);

  return {
    root,
    clickableMesh: torso,
    bodyMaterial: armorMaterial,
    rifleMaterial: darkMetal,
    muzzle,
    statusIcon,
    coreMagnetDome,
    bulwarkShield,
    repairArms: null,
    walkParts: [
      { node: crabLegFL, axis: 'x', base: 0, amplitude: 0.42, offset: 0 },
      { node: crabLegBR, axis: 'x', base: 0, amplitude: 0.42, offset: 0 },
      { node: crabLegFR, axis: 'x', base: 0, amplitude: 0.42, offset: Math.PI },
      { node: crabLegBL, axis: 'x', base: 0, amplitude: 0.42, offset: Math.PI },
      { node: armLeft, axis: 'x', base: 0, amplitude: 0.2, offset: Math.PI },
      { node: armRight, axis: 'x', base: 0, amplitude: 0.2, offset: 0 }
    ],
    baseY: 0.3
  };
}

function createSpecialistDroneVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  root.scale.setScalar(UNIT_MODEL_SCALE * 1.18);

  const armorMaterial = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.28,
    metalness: 0.62,
    emissive: 0x000000
  });
  armorMaterial.userData = { ownerColored: true, materialName: 'bodyMaterial' };
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x131a23,
    roughness: 0.36,
    metalness: 0.76,
    emissive: 0x000000
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xafbfd1,
    roughness: 0.32,
    metalness: 0.54
  });
  frameMaterial.userData = { ownerColored: false, materialName: 'frameMaterial' };
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x8be9fd,
    emissive: 0x1f5f76,
    emissiveIntensity: 0.72,
    roughness: 0.14,
    metalness: 0.2
  });

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.24), darkMetal);
  pelvis.name = 'pelvis';
  pelvis.position.set(0, 0.43, 0);
  pelvis.castShadow = true;
  root.add(pelvis);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.46, 0.28), armorMaterial);
  torso.name = 'clickable';
  torso.position.set(0, 0.86, 0);
  torso.castShadow = true;
  torso.userData = { type: 'unit', unitId: unit.id };
  root.add(torso);

  const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.05), visorMaterial);
  chestCore.name = 'chestCore';
  chestCore.position.set(0, 0.86, 0.17);
  root.add(chestCore);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.24), frameMaterial);
  head.name = 'head';
  head.position.set(0, 1.25, 0.04);
  head.castShadow = true;
  root.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.03), visorMaterial);
  visor.name = 'visor';
  visor.position.set(0, 1.24, 0.17);
  root.add(visor);

  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), frameMaterial);
  shoulderL.name = 'shoulderLeft';
  shoulderL.position.set(-0.34, 0.95, 0.05);
  shoulderL.castShadow = true;
  root.add(shoulderL);

  const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), frameMaterial);
  shoulderR.name = 'shoulderRight';
  shoulderR.position.set(0.34, 0.95, 0.05);
  shoulderR.castShadow = true;
  root.add(shoulderR);

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 12), frameMaterial);
  leftArm.name = 'walkPart_leftArm';
  leftArm.position.set(-0.41, 0.74, 0.12);
  leftArm.rotation.z = 0.28;
  leftArm.castShadow = true;
  root.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 12), frameMaterial);
  rightArm.name = 'walkPart_rightArm';
  rightArm.position.set(0.41, 0.74, 0.12);
  rightArm.rotation.z = -0.28;
  rightArm.castShadow = true;
  root.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), darkMetal);
  leftLeg.name = 'walkPart_leftLeg';
  leftLeg.position.set(-0.13, 0.17, 0.01);
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), darkMetal);
  rightLeg.name = 'walkPart_rightLeg';
  rightLeg.position.set(0.13, 0.17, 0.01);
  rightLeg.castShadow = true;
  root.add(rightLeg);

  const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.22), darkMetal);
  leftFoot.name = 'leftFoot';
  leftFoot.position.set(-0.13, -0.08, 0.06);
  leftFoot.castShadow = true;
  root.add(leftFoot);

  const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.22), darkMetal);
  rightFoot.name = 'rightFoot';
  rightFoot.position.set(0.13, -0.08, 0.06);
  rightFoot.castShadow = true;
  root.add(rightFoot);

  const rightGunBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.1), darkMetal);
  rightGunBody.name = 'rightGunBody';
  rightGunBody.position.set(0.28, 0.58, 0.22);
  rightGunBody.castShadow = true;
  root.add(rightGunBody);

  const rightBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.35, 12), darkMetal);
  rightBarrel.name = 'rightBarrel';
  rightBarrel.rotation.z = Math.PI / 2;
  rightBarrel.position.set(0.56, 0.58, 0.22);
  rightBarrel.castShadow = true;
  root.add(rightBarrel);

  const leftGunBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.1), darkMetal);
  leftGunBody.name = 'leftGunBody';
  leftGunBody.position.set(-0.28, 0.58, 0.22);
  leftGunBody.castShadow = true;
  root.add(leftGunBody);

  const leftBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.35, 12), darkMetal);
  leftBarrel.name = 'leftBarrel';
  leftBarrel.rotation.z = Math.PI / 2;
  leftBarrel.position.set(-0.56, 0.58, 0.22);
  leftBarrel.castShadow = true;
  root.add(leftBarrel);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.74, 0.58, 0.22);
  root.add(muzzle);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.95, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  return {
    root,
    clickableMesh: torso,
    bodyMaterial: armorMaterial,
    rifleMaterial: darkMetal,
    muzzle,
    statusIcon,
    coreMagnetDome: null,
    repairArms: null,
    walkParts: [
      { node: leftLeg, axis: 'x', base: 0, amplitude: 0.33, offset: 0 },
      { node: rightLeg, axis: 'x', base: 0, amplitude: 0.33, offset: Math.PI },
      { node: leftArm, axis: 'x', base: 0, amplitude: 0.16, offset: Math.PI },
      { node: rightArm, axis: 'x', base: 0, amplitude: 0.16, offset: 0 }
    ],
    baseY: 0.3,
    recoilX: 0
  };
}

function createPawnDroneVisual(unit: Unit): ExtendedUnitVisual {
  const root = new THREE.Group();
  root.name = 'root';
  root.scale.setScalar(UNIT_MODEL_SCALE);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: UNIT_COLORS[unit.owner],
    roughness: 0.33,
    metalness: 0.56,
    emissive: 0x000000
  });
  bodyMaterial.userData = { ownerColored: true, materialName: 'bodyMaterial' };

  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1f2732,
    roughness: 0.4,
    metalness: 0.7
  });
  darkMetal.userData = { ownerColored: false, materialName: 'darkMetal' };

  const shoulderMaterial = new THREE.MeshStandardMaterial({
    color: 0xadc4df,
    roughness: 0.32,
    metalness: 0.54
  });
  shoulderMaterial.userData = { ownerColored: false, materialName: 'shoulderMaterial' };

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 6, 12), bodyMaterial);
  torso.name = 'clickable';
  torso.position.y = 0.64;
  torso.castShadow = true;
  torso.userData = {
    type: 'unit',
    unitId: unit.id
  };
  root.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.14), shoulderMaterial);
  chestPlate.name = 'chestPlate';
  chestPlate.position.set(0, 0.68, 0.11);
  chestPlate.castShadow = true;
  root.add(chestPlate);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.23), shoulderMaterial);
  head.name = 'head';
  head.position.set(0, 1.03, 0.02);
  head.castShadow = true;
  root.add(head);

  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.04, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x8be9fd, emissive: 0x1a5f75, emissiveIntensity: 0.55 })
  );
  eye.name = 'eye';
  eye.position.set(0, 1.04, 0.14);
  root.add(eye);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.13), darkMetal);
  backpack.name = 'backpack';
  backpack.position.set(0, 0.69, -0.16);
  backpack.castShadow = true;
  root.add(backpack);

  const antennaL = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 8), darkMetal);
  antennaL.name = 'antennaLeft';
  antennaL.position.set(-0.07, 1.24, -0.18);
  antennaL.castShadow = true;
  root.add(antennaL);

  const antennaR = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 8), darkMetal);
  antennaR.name = 'antennaRight';
  antennaR.position.set(0.07, 1.24, -0.18);
  antennaR.castShadow = true;
  root.add(antennaR);

  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.18), darkMetal);
  hip.name = 'hip';
  hip.position.set(0, 0.42, 0);
  hip.castShadow = true;
  root.add(hip);

  const leftHipPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.16), shoulderMaterial);
  leftHipPlate.name = 'leftHipPlate';
  leftHipPlate.position.set(-0.19, 0.42, 0.02);
  leftHipPlate.castShadow = true;
  root.add(leftHipPlate);

  const rightHipPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.16), shoulderMaterial);
  rightHipPlate.name = 'rightHipPlate';
  rightHipPlate.position.set(0.19, 0.42, 0.02);
  rightHipPlate.castShadow = true;
  root.add(rightHipPlate);

  const leftThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 12), darkMetal);
  leftThigh.name = 'walkPart_leftThigh';
  leftThigh.position.set(-0.12, 0.29, 0);
  leftThigh.castShadow = true;
  root.add(leftThigh);

  const rightThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 12), darkMetal);
  rightThigh.name = 'walkPart_rightThigh';
  rightThigh.position.set(0.12, 0.29, 0);
  rightThigh.castShadow = true;
  root.add(rightThigh);

  const leftKnee = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), shoulderMaterial);
  leftKnee.name = 'leftKnee';
  leftKnee.position.set(-0.12, 0.18, 0.01);
  leftKnee.castShadow = true;
  root.add(leftKnee);

  const rightKnee = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), shoulderMaterial);
  rightKnee.name = 'rightKnee';
  rightKnee.position.set(0.12, 0.18, 0.01);
  rightKnee.castShadow = true;
  root.add(rightKnee);

  const leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.1), darkMetal);
  leftShin.name = 'walkPart_leftShin';
  leftShin.position.set(-0.12, 0.07, 0.01);
  leftShin.castShadow = true;
  root.add(leftShin);

  const rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.1), darkMetal);
  rightShin.name = 'walkPart_rightShin';
  rightShin.position.set(0.12, 0.07, 0.01);
  rightShin.castShadow = true;
  root.add(rightShin);

  const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.2), darkMetal);
  leftFoot.name = 'leftFoot';
  leftFoot.position.set(-0.12, -0.08, 0.06);
  leftFoot.castShadow = true;
  root.add(leftFoot);

  const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.2), darkMetal);
  rightFoot.name = 'rightFoot';
  rightFoot.position.set(0.12, -0.08, 0.06);
  rightFoot.castShadow = true;
  root.add(rightFoot);

  const leftShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), shoulderMaterial);
  leftShoulder.name = 'leftShoulder';
  leftShoulder.position.set(-0.24, 0.75, 0.03);
  leftShoulder.castShadow = true;
  root.add(leftShoulder);

  const rightShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), shoulderMaterial);
  rightShoulder.name = 'rightShoulder';
  rightShoulder.position.set(0.24, 0.75, 0.03);
  rightShoulder.castShadow = true;
  root.add(rightShoulder);

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), shoulderMaterial);
  leftArm.name = 'walkPart_leftArm';
  leftArm.position.set(-0.29, 0.59, 0.08);
  leftArm.rotation.z = 0.18;
  leftArm.castShadow = true;
  root.add(leftArm);

  const leftForearmGuard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), darkMetal);
  leftForearmGuard.name = 'leftForearmGuard';
  leftForearmGuard.position.set(-0.31, 0.48, 0.1);
  leftForearmGuard.rotation.z = 0.18;
  leftForearmGuard.castShadow = true;
  root.add(leftForearmGuard);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), shoulderMaterial);
  rightArm.name = 'walkPart_rightArm';
  rightArm.position.set(0.3, 0.59, 0.12);
  rightArm.rotation.z = -0.05;
  rightArm.rotation.x = -0.2;
  rightArm.castShadow = true;
  root.add(rightArm);

  const rightForearmGuard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), darkMetal);
  rightForearmGuard.name = 'rightForearmGuard';
  rightForearmGuard.position.set(0.33, 0.49, 0.15);
  rightForearmGuard.rotation.z = -0.05;
  rightForearmGuard.rotation.x = -0.2;
  rightForearmGuard.castShadow = true;
  root.add(rightForearmGuard);

  const rifleBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x121820,
    roughness: 0.35,
    metalness: 0.7,
    emissive: 0x000000
  });
  rifleBodyMaterial.userData = { ownerColored: false, materialName: 'rifleMaterial' };

  const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.09), rifleBodyMaterial);
  rifleBody.name = 'rifleBody';
  rifleBody.position.set(0.22, 0.58, 0.2);
  rifleBody.castShadow = true;
  root.add(rifleBody);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 12), rifleBodyMaterial);
  barrel.name = 'barrel';
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.56, 0.58, 0.2);
  barrel.castShadow = true;
  root.add(barrel);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.08), rifleBodyMaterial);
  stock.name = 'stock';
  stock.position.set(0.02, 0.58, 0.2);
  stock.castShadow = true;
  root.add(stock);

  const scope = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), shoulderMaterial);
  scope.name = 'scope';
  scope.position.set(0.27, 0.65, 0.2);
  scope.castShadow = true;
  root.add(scope);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0.74, 0.58, 0.2);
  root.add(muzzle);

  const statusBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.15
  });
  const statusIcon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), statusBulbMaterial);
  statusIcon.name = 'statusIcon';
  statusIcon.scale.set(1.2, 1.2, 1.2);
  statusIcon.position.set(0, 1.7, 0);
  statusIcon.castShadow = true;
  statusIcon.visible = false;
  root.add(statusIcon);

  return {
    root,
    clickableMesh: torso,
    bodyMaterial,
    rifleMaterial: rifleBodyMaterial,
    muzzle,
    statusIcon,
    coreMagnetDome: null,
    repairArms: null,
    walkParts: [
      { node: leftThigh, axis: 'x', base: 0, amplitude: 0.38, offset: 0 },
      { node: rightThigh, axis: 'x', base: 0, amplitude: 0.38, offset: Math.PI },
      { node: leftShin, axis: 'x', base: 0, amplitude: 0.26, offset: Math.PI },
      { node: rightShin, axis: 'x', base: 0, amplitude: 0.26, offset: 0 },
      { node: leftArm, axis: 'x', base: 0, amplitude: 0.22, offset: Math.PI },
      { node: rightArm, axis: 'x', base: -0.2, amplitude: 0.22, offset: 0 }
    ],
    baseY: 0.3,
    recoilX: 0
  };
}
