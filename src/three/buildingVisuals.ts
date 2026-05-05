import * as THREE from 'three';
import { TILE_SIZE } from '../constants.ts';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import type { Building, StatusId, PlayerId } from '../types';

interface BuildingVisualInput {
  owner: PlayerId;
  type: string;
  assignedStatusId?: StatusId;
}

interface BuildingVisualResult {
  root: THREE.Group;
  owner: PlayerId;
}

export function createBuildingVisual(building: BuildingVisualInput): BuildingVisualResult {
  if (building.type === 'ARMORY') {
    return createArmoryVisual(building);
  }
  if (building.type === 'REPLICATOR') {
    return createReplicatorVisual(building);
  }
  if (building.type === 'WORKSHOP') {
    return createWorkshopVisual(building);
  }
  if (building.type === 'DATACENTER') {
    return createDatacenterVisual(building);
  }
  if (building.type === 'GEAR_STATION') {
    return createGearStationVisual(building);
  }
  if (building.type === 'ASSEMBLY_LINE') {
    return createAssemblyLineVisual(building);
  }

  const root = new THREE.Group();
  root.name = 'root';
  return { root, owner: building.owner };
}

function createArmoryVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x477fe0 : 0xbf4652;
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x2f3c49,
    roughness: 0.62,
    metalness: 0.42
  });
  darkSteel.userData = { ownerColored: false, materialName: 'darkSteel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.44,
    metalness: 0.48
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };

  const platform = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.72, 0.5, TILE_SIZE * 0.72), darkSteel);
  platform.name = 'platform';
  platform.position.y = 0.25;
  platform.castShadow = true;
  platform.receiveShadow = true;
  root.add(platform);

  const mainBody = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, 0.9, TILE_SIZE * 0.44), ownerSteel);
  mainBody.name = 'mainBody';
  mainBody.position.set(0, 0.92, 0);
  mainBody.castShadow = true;
  root.add(mainBody);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.7, 10), darkSteel);
  tower.name = 'tower';
  tower.position.set(TILE_SIZE * 0.16, 1.58, 0);
  tower.castShadow = true;
  root.add(tower);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 10), darkSteel);
  barrel.name = 'barrel';
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(TILE_SIZE * 0.32, 1.6, 0);
  barrel.castShadow = true;
  root.add(barrel);

  const ventL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), ownerSteel);
  ventL.name = 'ventLeft';
  ventL.position.set(-TILE_SIZE * 0.18, 1.42, TILE_SIZE * 0.12);
  ventL.castShadow = true;
  root.add(ventL);

  const ventR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), ownerSteel);
  ventR.name = 'ventRight';
  ventR.position.set(-TILE_SIZE * 0.18, 1.42, -TILE_SIZE * 0.12);
  ventR.castShadow = true;
  root.add(ventR);

  if (building.assignedStatusId) {
    const statusIcon = createBuildingStatusIcon(building.assignedStatusId);
    if (statusIcon) {
      statusIcon.position.set(0, 2.05, 0);
      root.add(statusIcon);
    }
  }

  return { root, owner: building.owner };
}

function createReplicatorVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x4d8dff : 0xd85b66;
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x2a353f,
    roughness: 0.58,
    metalness: 0.46
  });
  darkSteel.userData = { ownerColored: false, materialName: 'darkSteel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.42,
    metalness: 0.52
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0x79d4ff,
    emissive: 0x2d9bf0,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.08
  });
  glowMaterial.userData = { ownerColored: false, materialName: 'glowMaterial' };

  const platform = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.76, 0.46, TILE_SIZE * 0.76), darkSteel);
  platform.name = 'platform';
  platform.position.y = 0.24;
  platform.castShadow = true;
  platform.receiveShadow = true;
  root.add(platform);

  const hall = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.58, 0.72, TILE_SIZE * 0.5), ownerSteel);
  hall.name = 'hall';
  hall.position.set(0, 0.78, 0);
  hall.castShadow = true;
  root.add(hall);

  const leftStack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.66, 10), darkSteel);
  leftStack.name = 'leftStack';
  leftStack.position.set(-TILE_SIZE * 0.2, 1.2, -TILE_SIZE * 0.14);
  leftStack.castShadow = true;
  root.add(leftStack);

  const rightStack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.66, 10), darkSteel);
  rightStack.name = 'rightStack';
  rightStack.position.set(TILE_SIZE * 0.2, 1.2, -TILE_SIZE * 0.14);
  rightStack.castShadow = true;
  root.add(rightStack);

  const conveyor = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.42, 0.12, TILE_SIZE * 0.24), darkSteel);
  conveyor.name = 'conveyor';
  conveyor.position.set(0, 1.06, TILE_SIZE * 0.08);
  conveyor.castShadow = true;
  root.add(conveyor);

  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 14), glowMaterial);
  core.name = 'core';
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 1.12, TILE_SIZE * 0.2);
  core.castShadow = true;
  root.add(core);

  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 10, 22), ownerSteel);
  frame.name = 'frame';
  frame.rotation.x = Math.PI / 2;
  frame.position.set(0, 1.12, TILE_SIZE * 0.2);
  frame.castShadow = true;
  root.add(frame);

  if (building.assignedStatusId) {
    const statusIcon = createBuildingStatusIcon(building.assignedStatusId);
    if (statusIcon) {
      statusIcon.position.set(0, 1.9, 0);
      root.add(statusIcon);
    }
  }

  return { root, owner: building.owner };
}

function createWorkshopVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x6f9eff : 0xe06a74;
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2d3a45,
    roughness: 0.6,
    metalness: 0.44
  });
  steel.userData = { ownerColored: false, materialName: 'steel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.45,
    metalness: 0.5
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };
  const accent = new THREE.MeshStandardMaterial({
    color: 0xf6c66f,
    emissive: 0x8f6b24,
    emissiveIntensity: 0.5,
    roughness: 0.26,
    metalness: 0.2
  });
  accent.userData = { ownerColored: false, materialName: 'accent' };

  const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.72, 0.44, TILE_SIZE * 0.72), steel);
  base.name = 'base';
  base.position.y = 0.22;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const body = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.52, 0.72, TILE_SIZE * 0.52), ownerSteel);
  body.name = 'body';
  body.position.set(0, 0.8, 0);
  body.castShadow = true;
  root.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(TILE_SIZE * 0.26, 0.34, 4), steel);
  roof.name = 'roof';
  roof.position.set(0, 1.32, 0);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  root.add(roof);

  const gantry = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.46, 0.08, 0.1), steel);
  gantry.name = 'gantry';
  gantry.position.set(0, 1.0, TILE_SIZE * 0.18);
  gantry.castShadow = true;
  root.add(gantry);

  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 14, Math.PI * 1.4), accent);
  hook.name = 'hook';
  hook.position.set(0, 0.9, TILE_SIZE * 0.18);
  hook.rotation.z = 0.3;
  hook.castShadow = true;
  root.add(hook);

  const sideTank = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), ownerSteel);
  sideTank.name = 'sideTank';
  sideTank.position.set(-TILE_SIZE * 0.24, 0.9, -TILE_SIZE * 0.08);
  sideTank.castShadow = true;
  root.add(sideTank);

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), accent);
  lamp.name = 'lamp';
  lamp.position.set(TILE_SIZE * 0.2, 1.08, TILE_SIZE * 0.12);
  lamp.castShadow = true;
  root.add(lamp);

  return { root, owner: building.owner };
}

function createDatacenterVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x68a0ff : 0xe36b77;
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2a3642,
    roughness: 0.58,
    metalness: 0.46
  });
  steel.userData = { ownerColored: false, materialName: 'steel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.42,
    metalness: 0.48
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };
  const glow = new THREE.MeshStandardMaterial({
    color: 0x9be0ff,
    emissive: 0x3595e8,
    emissiveIntensity: 0.72,
    roughness: 0.2,
    metalness: 0.12
  });
  glow.userData = { ownerColored: false, materialName: 'glowMaterial' };

  const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.74, 0.44, TILE_SIZE * 0.74), steel);
  base.name = 'base';
  base.position.y = 0.22;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.34, 1.1, TILE_SIZE * 0.34), ownerSteel);
  tower.name = 'tower';
  tower.position.set(0, 0.98, 0);
  tower.castShadow = true;
  root.add(tower);

  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.22, 12), steel);
  topCap.name = 'topCap';
  topCap.position.set(0, 1.62, 0);
  topCap.castShadow = true;
  root.add(topCap);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 10), steel);
  mast.name = 'mast';
  mast.position.set(0, 2.02, 0);
  mast.castShadow = true;
  root.add(mast);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), glow);
  beacon.name = 'beacon';
  beacon.position.set(0, 2.38, 0);
  beacon.castShadow = true;
  root.add(beacon);

  const sideModuleA = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.18, 0.32, TILE_SIZE * 0.22), ownerSteel);
  sideModuleA.name = 'sideModuleA';
  sideModuleA.position.set(TILE_SIZE * 0.19, 0.72, 0);
  sideModuleA.castShadow = true;
  root.add(sideModuleA);

  const sideModuleB = sideModuleA.clone();
  sideModuleB.name = 'sideModuleB';
  sideModuleB.position.set(-TILE_SIZE * 0.19, 0.72, 0);
  root.add(sideModuleB);

  return { root, owner: building.owner };
}

function createGearStationVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x70a9ff : 0xe97682;
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2b3743,
    roughness: 0.6,
    metalness: 0.44
  });
  steel.userData = { ownerColored: false, materialName: 'steel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.44,
    metalness: 0.5
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };
  const amber = new THREE.MeshStandardMaterial({
    color: 0xf8c96a,
    emissive: 0xa46f1a,
    emissiveIntensity: 0.48,
    roughness: 0.28,
    metalness: 0.2
  });
  amber.userData = { ownerColored: false, materialName: 'amber' };

  const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.74, 0.42, TILE_SIZE * 0.74), steel);
  base.name = 'base';
  base.position.y = 0.22;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const body = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, 0.76, TILE_SIZE * 0.5), ownerSteel);
  body.name = 'body';
  body.position.set(0, 0.8, 0);
  body.castShadow = true;
  root.add(body);

  const gearCore = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.2, 14), steel);
  gearCore.name = 'gearCore';
  gearCore.rotation.x = Math.PI / 2;
  gearCore.position.set(0, 1.1, TILE_SIZE * 0.2);
  gearCore.castShadow = true;
  root.add(gearCore);

  const gearTeeth = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 10, 20), ownerSteel);
  gearTeeth.name = 'gearTeeth';
  gearTeeth.rotation.x = Math.PI / 2;
  gearTeeth.position.set(0, 1.1, TILE_SIZE * 0.2);
  gearTeeth.castShadow = true;
  root.add(gearTeeth);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.56, 10), steel);
  antenna.name = 'antenna';
  antenna.position.set(-TILE_SIZE * 0.16, 1.5, -TILE_SIZE * 0.1);
  antenna.castShadow = true;
  root.add(antenna);

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), amber);
  lamp.name = 'lamp';
  lamp.position.set(-TILE_SIZE * 0.16, 1.82, -TILE_SIZE * 0.1);
  lamp.castShadow = true;
  root.add(lamp);

  return { root, owner: building.owner };
}

function createAssemblyLineVisual(building: BuildingVisualInput): BuildingVisualResult {
  const root = new THREE.Group();
  root.name = 'root';
  const ownerColor = building.owner === 'A' ? 0x6ea4ff : 0xe87380;
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2b3844,
    roughness: 0.6,
    metalness: 0.44
  });
  steel.userData = { ownerColored: false, materialName: 'steel' };
  const ownerSteel = new THREE.MeshStandardMaterial({
    color: ownerColor,
    roughness: 0.44,
    metalness: 0.5
  });
  ownerSteel.userData = { ownerColored: true, materialName: 'ownerSteel' };
  const beltMat = new THREE.MeshStandardMaterial({
    color: 0x70859a,
    roughness: 0.35,
    metalness: 0.38
  });
  beltMat.userData = { ownerColored: false, materialName: 'beltMaterial' };

  const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.76, 0.42, TILE_SIZE * 0.76), steel);
  base.name = 'base';
  base.position.y = 0.22;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const line = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.58, 0.18, TILE_SIZE * 0.2), beltMat);
  line.name = 'line';
  line.position.set(0, 0.58, TILE_SIZE * 0.14);
  line.castShadow = true;
  root.add(line);

  const leftRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, TILE_SIZE * 0.22, 12), ownerSteel);
  leftRoller.name = 'leftRoller';
  leftRoller.rotation.z = Math.PI / 2;
  leftRoller.position.set(-TILE_SIZE * 0.24, 0.58, TILE_SIZE * 0.14);
  leftRoller.castShadow = true;
  root.add(leftRoller);

  const rightRoller = leftRoller.clone();
  rightRoller.name = 'rightRoller';
  rightRoller.position.set(TILE_SIZE * 0.24, 0.58, TILE_SIZE * 0.14);
  root.add(rightRoller);

  const module = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.42, 0.64, TILE_SIZE * 0.36), ownerSteel);
  module.name = 'module';
  module.position.set(0, 0.98, -TILE_SIZE * 0.05);
  module.castShadow = true;
  root.add(module);

  const rail = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.5, 0.06, 0.08), steel);
  rail.name = 'rail';
  rail.position.set(0, 1.34, -TILE_SIZE * 0.05);
  rail.castShadow = true;
  root.add(rail);

  return { root, owner: building.owner };
}

export function createBuildingStatusIcon(statusId: StatusId): THREE.Sprite | null {
  const template = DRONE_STATUS_LIBRARY[statusId];
  if (!template) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(16, 26, 36, 0.92)';
  ctx.beginPath();
  ctx.arc(64, 64, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(129, 169, 208, 0.95)';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = '54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0f7ff';
  ctx.fillText(template.iconSymbol ?? '+', 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.9, 0.9, 0.9);
  return sprite;
}
