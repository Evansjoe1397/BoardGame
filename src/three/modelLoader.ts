import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PlayerId } from '../types.ts';
import { UNIT_COLORS } from '../constants.ts';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();

// Unit type ID -> filename mapping
const UNIT_MODEL_FILES: Record<string, string> = {
  PAWN_DRONE_UNIT: 'pawn_drone',
  TANK_DRONE_UNIT: 'tank_drone',
  SUPPORT_DRONE_UNIT: 'support_drone',
  GHOSTBLADE_UNIT: 'ghostblade',
  ARTILLERY_UNIT: 'artillery',
  SPECIALIST_UNIT: 'specialist',
};

const BUILDING_MODEL_FILES: Record<string, string> = {
  ARMORY: 'armory',
  REPLICATOR: 'replicator',
  WORKSHOP: 'workshop',
  DATACENTER: 'datacenter',
  GEAR_STATION: 'gear_station',
  ASSEMBLY_LINE: 'assembly_line',
};

const MODEL_BASE_PATH = '/models/';

/**
 * Attempt to preload all .glb models. Missing files are silently skipped
 * (the game falls back to procedural creation for those types).
 */
export async function preloadModels(): Promise<void> {
  const allKeys = [
    ...Object.entries(UNIT_MODEL_FILES),
    ...Object.entries(BUILDING_MODEL_FILES),
  ];

  const promises = allKeys.map(async ([typeId, filename]) => {
    const url = `${MODEL_BASE_PATH}${filename}.glb`;
    try {
      const gltf = await loader.loadAsync(url);
      modelCache.set(typeId, gltf.scene);
      console.log(`[modelLoader] Loaded ${filename}.glb`);
    } catch {
      // File doesn't exist yet — procedural fallback will be used
    }
  });

  await Promise.allSettled(promises);
  console.log(`[modelLoader] ${modelCache.size}/${allKeys.length} models loaded`);
}

/**
 * Check if a model is available for the given type ID.
 */
export function hasPreloadedModel(typeId: string): boolean {
  return modelCache.has(typeId);
}

/**
 * Clone a preloaded model and recolor it for the given owner.
 * Returns null if no preloaded model exists (fall back to procedural).
 */
export function cloneModel(typeId: string, owner: PlayerId): THREE.Group | null {
  const template = modelCache.get(typeId);
  if (!template) return null;

  const clone = template.clone(true); // deep clone
  recolorForOwner(clone, owner);
  return clone;
}

/**
 * Walk the cloned scene graph and swap owner-colored materials.
 * Convention: meshes with userData.ownerColored = true get recolored.
 */
function recolorForOwner(group: THREE.Group, owner: PlayerId): void {
  const ownerColor = new THREE.Color(UNIT_COLORS[owner]);

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.userData?.ownerColored) {
        // Clone material so units don't share the same material instance
        const clonedMat = mat.clone();
        clonedMat.color.copy(ownerColor);
        mesh.material = clonedMat;
      }
    }
  });
}

/**
 * Find a named mesh/object in a loaded model scene graph.
 */
export function findNamed(group: THREE.Group, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((child) => {
    if (child.name === name) found = child;
  });
  return found;
}

/**
 * Find a named mesh specifically.
 */
export function findNamedMesh(group: THREE.Group, name: string): THREE.Mesh | null {
  const obj = findNamed(group, name);
  return obj && (obj as THREE.Mesh).isMesh ? (obj as THREE.Mesh) : null;
}

/**
 * Find the first MeshStandardMaterial with a given name in userData.
 */
export function findNamedMaterial(group: THREE.Group, materialName: string): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat?.userData?.materialName === materialName) {
        found = mat;
      }
    }
  });
  return found;
}
