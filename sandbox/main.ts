/**
 * Asteroid FPS sandbox — asset-driven minimal version.
 *
 * - Asteroid: real glb mesh from Sketchfab. Used as both visual and
 *   collision; surface height is sampled via raycasting (so player &
 *   props sit flush regardless of mesh irregularity).
 * - Weapon: animated FPS rig glb (includes first-person arms + rifle).
 *   Animations played via AnimationMixer (Fire on click).
 * - Decoration: rocks scattered on the surface via InstancedMesh.
 *
 * Self-contained: does NOT import from src/.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

// --- constants ------------------------------------------------------------

const TARGET_PLANET_DIAMETER = 80;  // longest bbox dim of asteroid scaled to this many metres
const GRAVITY = 18;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 7;
const SPRINT_SPEED = 12;
const JUMP_SPEED = 9;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const ROCK_COUNT = 50;
const MONSTER_COUNT = 8;
const MONSTER_SPEED = 2.2;       // m/s along the surface
const MONSTER_HEIGHT = 1.8;      // target height in metres after scaling
const MONSTER_TOUCH_DIST = 1.4;  // when within this, monster stops (touched player)

const MODEL_BASE = '/sandbox/models/';

// --- DOM ------------------------------------------------------------------

const appEl = document.getElementById('app')!;
const overlayEl = document.getElementById('overlay')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const creditsEl = document.getElementById('credits')!;
const infoEl = document.getElementById('info')!;

// --- renderer / scene -----------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080f);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
scene.add(camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- starfield ------------------------------------------------------------

{
  const N = 1800;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize().multiplyScalar(700);
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false })));
}

// --- lighting -------------------------------------------------------------

scene.add(new THREE.AmbientLight(0x4a5568, 0.45));
scene.add(new THREE.HemisphereLight(0x88aaff, 0x303020, 0.3));

const sun = new THREE.DirectionalLight(0xffe5b8, 1.6);
sun.position.set(150, 200, 100);
scene.add(sun);

const headlight = new THREE.PointLight(0xffe5b8, 0.5, 5, 1.4);
headlight.position.set(0, 0.05, -0.05);
camera.add(headlight);

// --- glb loader -----------------------------------------------------------

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

function meshOnlyBbox(root: THREE.Object3D): THREE.Box3 {
  const result = new THREE.Box3();
  result.makeEmpty();
  root.updateMatrixWorld(true);
  const tmp = new THREE.Box3();
  root.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const gb = m.geometry.boundingBox;
      if (gb) { tmp.copy(gb).applyMatrix4(m.matrixWorld); result.union(tmp); }
    }
  });
  return result;
}

// --- asteroid -------------------------------------------------------------

let asteroidMesh: THREE.Object3D | null = null;
let asteroidBoundingRadius = 40; // updated after load
const asteroidRaycaster = new THREE.Raycaster();

async function loadAsteroid(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}asteroid.glb`); }
  catch (e) { console.error('[asteroid] load failed:', e); return; }

  const root = gltf.scene;

  // Compute mesh-only bbox to drive scale.
  const tmpRoot = new THREE.Group();
  tmpRoot.add(root);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = TARGET_PLANET_DIAMETER / maxDim;

  // Center the asteroid at world origin (at scene root, not at tmpRoot) and scale.
  const wrap = new THREE.Group();
  root.position.set(-center.x, -center.y, -center.z);
  wrap.add(root);
  wrap.scale.setScalar(scale);
  scene.add(wrap);

  // Bounding radius post-scale: max distance from center to any vertex.
  let maxRsq = 0;
  root.updateMatrixWorld(true);
  root.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const d2 = v.lengthSq();
        if (d2 > maxRsq) maxRsq = d2;
      }
    }
  });
  asteroidBoundingRadius = Math.sqrt(maxRsq) * scale;
  asteroidMesh = wrap;

  console.log(`[asteroid] loaded: bbox=${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}, scale=${scale.toFixed(3)}, boundingRadius=${asteroidBoundingRadius.toFixed(2)}`);
}

/**
 * Raycast from outside the asteroid in `dir` direction (i.e. start at
 * dir*R*3, shoot toward -dir) and return the first surface point. Returns
 * null if the ray misses the mesh entirely.
 */
function asteroidSurfacePoint(dir: THREE.Vector3): THREE.Vector3 | null {
  if (!asteroidMesh) return null;
  const ro = dir.clone().multiplyScalar(asteroidBoundingRadius * 2.5);
  const rd = dir.clone().negate();
  asteroidRaycaster.set(ro, rd);
  asteroidRaycaster.far = asteroidBoundingRadius * 5;
  const hits = asteroidRaycaster.intersectObject(asteroidMesh, true);
  return hits[0]?.point.clone() ?? null;
}

// --- surface lookup table -------------------------------------------------

/**
 * Cache the asteroid's surface radius along directions sampled on a lat/lon
 * grid. Per-frame surface queries are then O(1) lookups + bilinear interp,
 * instead of raycasting 5k+ triangles every frame for the player and each
 * flying fragment. The actual raycast is reserved for shooting (where we
 * want exact hit points).
 */
const SURF_LAT = 64;     // theta: 0..π
const SURF_LON = 128;    // phi:   0..2π
const surfTable = new Float32Array(SURF_LAT * SURF_LON);
let surfTableReady = false;

function buildSurfaceTable(): void {
  if (!asteroidMesh) return;
  const dir = new THREE.Vector3();
  for (let i = 0; i < SURF_LAT; i++) {
    const theta = (i / (SURF_LAT - 1)) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j < SURF_LON; j++) {
      const phi = (j / SURF_LON) * 2 * Math.PI;
      dir.set(sinT * Math.cos(phi), cosT, sinT * Math.sin(phi));
      const p = asteroidSurfacePoint(dir);
      surfTable[i * SURF_LON + j] = p ? p.length() : asteroidBoundingRadius;
    }
  }
  surfTableReady = true;
  console.log(`[asteroid] surface table built: ${SURF_LAT}x${SURF_LON} samples`);
}

/**
 * O(1) surface radius along a unit direction, bilinearly interpolated from
 * the precomputed lat/lon table. Falls back to bounding radius if not ready.
 */
function getSurfaceRadius(dir: THREE.Vector3): number {
  if (!surfTableReady) return asteroidBoundingRadius;
  const dy = Math.max(-1, Math.min(1, dir.y));
  const theta = Math.acos(dy);                   // 0..π
  const phi = Math.atan2(dir.z, dir.x);          // -π..π
  const phiN = phi >= 0 ? phi / (2 * Math.PI) : 1 + phi / (2 * Math.PI); // 0..1

  const tIdx = (theta / Math.PI) * (SURF_LAT - 1);
  const pIdx = phiN * SURF_LON;
  const t0 = Math.floor(tIdx);
  const t1 = Math.min(t0 + 1, SURF_LAT - 1);
  const p0 = Math.floor(pIdx) % SURF_LON;
  const p1 = (p0 + 1) % SURF_LON;
  const tf = tIdx - t0;
  const pf = pIdx - Math.floor(pIdx);

  const v00 = surfTable[t0 * SURF_LON + p0];
  const v01 = surfTable[t0 * SURF_LON + p1];
  const v10 = surfTable[t1 * SURF_LON + p0];
  const v11 = surfTable[t1 * SURF_LON + p1];
  return (v00 * (1 - pf) + v01 * pf) * (1 - tf) + (v10 * (1 - pf) + v11 * pf) * tf;
}

/**
 * Find the surface "below" a position. Two flavours:
 *   - exact: raycast against the asteroid mesh (one ray, accurate for player)
 *   - approx: bilinearly-interpolated table lookup (cheap, used for fragments)
 *
 * The table can underestimate the radius for convex/non-grid-aligned
 * directions, which would cause the player to clip through the surface — so
 * the player MUST use the exact path.
 */
function findGroundExact(pos: THREE.Vector3): { point: THREE.Vector3; up: THREE.Vector3 } | null {
  if (pos.lengthSq() < 1e-6) return null;
  const up = pos.clone().normalize();
  const surface = asteroidSurfacePoint(up);
  if (!surface) return null;
  return { point: surface, up };
}

function findGroundApprox(pos: THREE.Vector3): { point: THREE.Vector3; up: THREE.Vector3 } | null {
  if (pos.lengthSq() < 1e-6) return null;
  const up = pos.clone().normalize();
  const r = getSurfaceRadius(up);
  return { point: up.clone().multiplyScalar(r), up };
}

// --- rocks ----------------------------------------------------------------

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
}

const fragments: Fragment[] = [];
const FRAG_LIFE = 2.6;
const FRAG_FADE = 0.7;
const FRAG_MAX_PER_SHATTER = 400;

interface RockInstance {
  slot: number;
  worldMatrix: THREE.Matrix4;
  alive: boolean;
}

const rocks: RockInstance[] = [];
let rockInstanced: THREE.InstancedMesh | null = null;
let rockGeometry: THREE.BufferGeometry | null = null;
let rockMaterial: THREE.Material | null = null;

async function loadAndScatterRocks(): Promise<void> {
  if (!asteroidMesh) return;
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}rock.glb`); }
  catch (e) { console.warn('[rock] load failed:', e); return; }

  let firstMesh: THREE.Mesh | null = null;
  gltf.scene.traverse(c => {
    if (!firstMesh && (c as THREE.Mesh).isMesh) firstMesh = c as THREE.Mesh;
  });
  if (!firstMesh) return;
  const mesh = firstMesh as THREE.Mesh;

  mesh.updateMatrixWorld(true);
  const baseGeom = mesh.geometry.clone();
  baseGeom.applyMatrix4(mesh.matrixWorld);
  baseGeom.computeBoundingBox();
  const bbox = baseGeom.boundingBox!;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const targetSize = 1.6;
  const scale = targetSize / maxDim;

  // Center horizontally, base at y=0, then scale.
  const norm = new THREE.Matrix4().makeScale(scale, scale, scale);
  norm.multiply(new THREE.Matrix4().makeTranslation(-center.x, -bbox.min.y, -center.z));
  baseGeom.applyMatrix4(norm);

  const material = Array.isArray(mesh.material) ? mesh.material[0].clone() : (mesh.material as THREE.Material).clone();
  rockGeometry = baseGeom;
  rockMaterial = material;

  const inst = new THREE.InstancedMesh(baseGeom, material, ROCK_COUNT);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  scene.add(inst);
  rockInstanced = inst;

  const upY = new THREE.Vector3(0, 1, 0);
  const tmpMat = new THREE.Matrix4();
  let placed = 0;
  let attempts = 0;
  while (placed < ROCK_COUNT && attempts < ROCK_COUNT * 4) {
    attempts++;
    const dir = new THREE.Vector3().randomDirection();
    const surf = asteroidSurfacePoint(dir);
    if (!surf) continue;
    const orient = new THREE.Quaternion().setFromUnitVectors(upY, dir);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(dir, Math.random() * Math.PI * 2);
    orient.multiply(yawQ);
    const sizeMul = 0.7 + Math.random() * 0.7;
    tmpMat.compose(surf, orient, new THREE.Vector3(sizeMul, sizeMul, sizeMul));
    inst.setMatrixAt(placed, tmpMat);
    rocks.push({ slot: placed, worldMatrix: tmpMat.clone(), alive: true });
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  console.log(`[rock] placed ${placed}/${ROCK_COUNT}`);
}

function shatterRock(target: RockInstance, hitPoint: THREE.Vector3): void {
  if (!target.alive || !rockInstanced || !rockGeometry || !rockMaterial) return;
  target.alive = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  rockInstanced.setMatrixAt(target.slot, zero);
  rockInstanced.instanceMatrix.needsUpdate = true;

  const pos = rockGeometry.attributes.position as THREE.BufferAttribute;
  const idx = rockGeometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const m = target.worldMatrix;
  const step = Math.max(1, Math.ceil(triCount / FRAG_MAX_PER_SHATTER));
  const srcMat = rockMaterial as THREE.MeshStandardMaterial;

  for (let t = 0; t < triCount; t += step) {
    const ai = idx ? idx.getX(t * 3)     : t * 3;
    const bi = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ci = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const a = new THREE.Vector3().fromBufferAttribute(pos, ai).applyMatrix4(m);
    const b = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(m);
    const c = new THREE.Vector3().fromBufferAttribute(pos, ci).applyMatrix4(m);
    const center = a.clone().add(b).add(c).divideScalar(3);

    const fragGeom = new THREE.BufferGeometry();
    fragGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x - center.x, a.y - center.y, a.z - center.z,
      b.x - center.x, b.y - center.y, b.z - center.z,
      c.x - center.x, c.y - center.y, c.z - center.z,
    ], 3));
    fragGeom.computeVertexNormals();

    const fragMat = new THREE.MeshStandardMaterial({
      color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0x888888),
      roughness: srcMat.roughness ?? 0.9,
      metalness: srcMat.metalness ?? 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      flatShading: true,
    });
    const fragMesh = new THREE.Mesh(fragGeom, fragMat);
    fragMesh.position.copy(center);

    const outward = center.clone().sub(hitPoint);
    const dist = outward.length() || 0.0001;
    outward.divideScalar(dist);
    const speed = 4 + Math.random() * 5;
    const velocity = outward.multiplyScalar(speed);
    velocity.x += (Math.random() - 0.5) * 2;
    velocity.y += (Math.random() - 0.5) * 2;
    velocity.z += (Math.random() - 0.5) * 2;
    const angVel = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);

    scene.add(fragMesh);
    fragments.push({ mesh: fragMesh, velocity, angVel, life: 0, maxLife: FRAG_LIFE });
  }
}

function updateFragments(dt: number): void {
  for (let i = fragments.length - 1; i >= 0; i--) {
    const f = fragments[i];
    f.life += dt;
    const radial = f.mesh.position.clone().normalize();
    f.velocity.addScaledVector(radial, -GRAVITY * dt);
    f.mesh.position.addScaledVector(f.velocity, dt);
    f.mesh.rotation.x += f.angVel.x * dt;
    f.mesh.rotation.y += f.angVel.y * dt;
    f.mesh.rotation.z += f.angVel.z * dt;

    // bounce on asteroid surface (approx table — fragments are visual only)
    const ground = findGroundApprox(f.mesh.position);
    if (ground) {
      const surfR = ground.point.length();
      const fragR = f.mesh.position.length();
      if (fragR < surfR + 0.05) {
        const n = ground.up;
        const vDotN = f.velocity.dot(n);
        if (vDotN < 0) {
          f.velocity.addScaledVector(n, -1.5 * vDotN);
          f.velocity.multiplyScalar(0.4);
          f.angVel.multiplyScalar(0.6);
        }
        f.mesh.position.copy(ground.point).addScaledVector(n, 0.05);
      }
    }

    const remaining = f.maxLife - f.life;
    if (remaining < FRAG_FADE) {
      (f.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, remaining / FRAG_FADE);
    }
    if (f.life >= f.maxLife) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
      fragments.splice(i, 1);
    }
  }
}

// --- monsters -------------------------------------------------------------

interface MonsterTemplate {
  scene: THREE.Object3D;        // raw gltf scene (cloned per spawn)
  clips: THREE.AnimationClip[];
  walkClipName?: string;        // pre-resolved walk clip name
  scale: number;                // uniform scale to MONSTER_HEIGHT
  baseY: number;                // y-shift so feet are at y=0 in template
  centerXZ: { x: number; z: number };
}

let monsterTemplate: MonsterTemplate | null = null;

interface Monster {
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walkAction: THREE.AnimationAction | null;
  /** World-space foot position on the asteroid surface. */
  position: THREE.Vector3;
  alive: boolean;
}

const monsters: Monster[] = [];

async function loadMonsterTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}monster.glb`); }
  catch (e) { console.warn('[monster] load failed:', e); return; }

  const root = gltf.scene;
  const tmpRoot = new THREE.Group();
  tmpRoot.add(root);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const targetH = MONSTER_HEIGHT;
  const heightAxis = Math.max(size.x, size.y, size.z);
  const scale = targetH / (heightAxis || 1);

  // diagnostic: count meshes / skinned-meshes / materials in the template
  let meshCount = 0, skinnedCount = 0, materialCount = 0;
  root.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      meshCount++;
      if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) skinnedCount++;
      if (m.material) materialCount++;
    }
  });

  monsterTemplate = {
    scene: root,
    clips: gltf.animations,
    walkClipName: gltf.animations.find(c => /walk|run|move/i.test(c.name))?.name
                ?? gltf.animations[0]?.name,
    scale,
    baseY: -bbox.min.y,
    centerXZ: { x: center.x, z: center.z },
  };
  console.log(`[monster] template loaded:
  bbox: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} (m, glb units)
  center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}
  scale: ${scale.toFixed(3)} → final height ${targetH}m
  baseY shift: ${monsterTemplate.baseY.toFixed(2)}
  meshes: ${meshCount} (skinned: ${skinnedCount}), materials: ${materialCount}
  clips: [${gltf.animations.map(c => `${c.name}/${c.duration.toFixed(2)}s`).join(', ')}]
  walk: "${monsterTemplate.walkClipName}"`);
}

function spawnMonster(dir: THREE.Vector3): void {
  if (!monsterTemplate) return;
  // SkeletonUtils.clone preserves the skeleton — plain clone() shares bones,
  // which causes all monsters to animate in lockstep.
  const inst = cloneSkeleton(monsterTemplate.scene) as THREE.Object3D;

  // Hierarchy: wrap (world position + scale + lookAt rotation) ← inst.
  // Centering offset sits on inst (in glb units, before scale). Putting the
  // scale on the OUTER wrap makes the offset behave consistently regardless
  // of the model's source unit (otherwise a non-1.0 scale shifts the feet).
  inst.position.set(-monsterTemplate.centerXZ.x, monsterTemplate.baseY, -monsterTemplate.centerXZ.z);

  const wrap = new THREE.Group();
  wrap.add(inst);
  wrap.scale.setScalar(monsterTemplate.scale);

  // Place on surface immediately so the first frame doesn't show monsters
  // bunched at world origin.
  const surf = asteroidSurfacePoint(dir);
  const position = surf ?? dir.clone().multiplyScalar(asteroidBoundingRadius);
  wrap.position.copy(position);
  wrap.up.copy(dir);
  scene.add(wrap);

  // DEBUG marker: bright red sphere at the monster's spawn point. If the
  // user sees these but no zombies, the model is the issue (skeleton clone,
  // material, animation collapse). If no markers either, the position
  // calculation is wrong.
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  marker.position.copy(position).add(dir.clone().multiplyScalar(2)); // 2m above the surface
  scene.add(marker);

  const mixer = new THREE.AnimationMixer(inst);
  let walkAction: THREE.AnimationAction | null = null;
  if (monsterTemplate.walkClipName) {
    const clip = monsterTemplate.clips.find(c => c.name === monsterTemplate!.walkClipName);
    if (clip) {
      walkAction = mixer.clipAction(clip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.time = Math.random() * clip.duration;
      walkAction.play();
    }
  }

  monsters.push({ group: wrap, mixer, walkAction, position, alive: true });
  console.log(`[monster] spawned at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
}

async function spawnInitialMonsters(): Promise<void> {
  if (!monsterTemplate) return;
  let placed = 0, attempts = 0;
  while (placed < MONSTER_COUNT && attempts < MONSTER_COUNT * 4) {
    attempts++;
    const dir = new THREE.Vector3().randomDirection();
    const surf = asteroidSurfacePoint(dir);
    if (!surf) continue;
    spawnMonster(dir);
    placed++;
  }
  console.log(`[monster] spawned ${placed}/${MONSTER_COUNT}`);
}

function tickMonsters(dt: number): void {
  for (const m of monsters) {
    if (!m.alive) continue;
    m.mixer.update(dt);

    // Vector from monster's foot position toward player (world space)
    const toPlayer = player.position.clone().sub(m.position);
    const dist = toPlayer.length();

    if (dist > MONSTER_TOUCH_DIST) {
      // Project the to-player vector onto the local tangent plane (perp to
      // monster's outward direction) so we walk along the surface.
      const up = m.position.clone().normalize();
      const tangent = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
      if (tangent.lengthSq() > 1e-6) {
        tangent.normalize();
        m.position.addScaledVector(tangent, MONSTER_SPEED * dt);
        // snap back to surface (table lookup is OK here — small inaccuracy
        // doesn't matter for monsters)
        const newUp = m.position.clone().normalize();
        const r = getSurfaceRadius(newUp);
        m.position.copy(newUp).multiplyScalar(r);
      }
    }

    // Orient: stand up, face the player.
    const stand = m.position.clone().normalize();
    m.group.position.copy(m.position);
    m.group.up.copy(stand);
    // look toward player projected onto tangent plane
    const lookTarget = m.position.clone().add(toPlayer);
    m.group.lookAt(lookTarget);
  }
}

// --- weapon (FPS rig glb with arms + animations) --------------------------

interface WeaponState {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  fireClip: THREE.AnimationClip | null;
  idleClip: THREE.AnimationClip | null;
  cooldown: number;
}

let weapon: WeaponState | null = null;
const FIRE_COOLDOWN = 0.10;
const FIRE_RANGE = 200;

async function loadWeapon(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}fps_rifle.glb`); }
  catch (e) { console.error('[weapon] load failed:', e); return; }

  const inner = gltf.scene;

  // Compute bbox to size the rig sensibly. FPS rigs are typically large in
  // glb units (e.g. character-scale); we want it to fit visibly in front of
  // the camera — target longest dim ≈ 0.9m.
  const tmpRoot = new THREE.Group();
  tmpRoot.add(inner);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const targetSize = 0.9;
  const scale = targetSize / maxDim;

  // Hierarchy:
  //   wrap (camera-relative pos + scale) ← orient (default rig orientation)
  //     ← centerNode (translation to put bbox center at origin)
  //       ← inner
  // This way centering is applied BEFORE rotation, so the rig stays put when
  // we adjust the orient angle.
  const wrap = new THREE.Group();
  const orient = new THREE.Group();
  const centerNode = new THREE.Group();
  centerNode.position.set(-center.x, -center.y, -center.z);
  centerNode.add(inner);
  orient.add(centerNode);
  wrap.add(orient);

  wrap.scale.setScalar(scale);
  // Default placement: a little right, a little down, in front of camera.
  // FPS rigs are usually authored facing -Z already, so no rotation by default.
  wrap.position.set(0.0, -0.15, -0.45);
  // Camera-attached meshes are culled with their LOCAL bounding sphere against
  // the world frustum, which can flicker when the bounds straddle the near
  // plane during head-bob / movement. Force everything in this rig to skip the
  // culling check so it renders every frame.
  wrap.traverse(c => { c.frustumCulled = false; });
  camera.add(wrap);

  // animations
  const clips = gltf.animations;
  const mixer = clips.length > 0 ? new THREE.AnimationMixer(inner) : null;
  let fireClip: THREE.AnimationClip | null = null;
  let idleClip: THREE.AnimationClip | null = null;
  for (const clip of clips) {
    const n = clip.name.toLowerCase();
    if (!fireClip && (n.includes('fire') || n.includes('shoot') || n.includes('attack'))) fireClip = clip;
    if (!idleClip && (n.includes('idle') || n.includes('rest'))) idleClip = clip;
  }
  if (mixer && idleClip) {
    const a = mixer.clipAction(idleClip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
  }

  console.log(`[weapon] loaded: bbox=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}, scale=${scale.toFixed(3)}, clips=[${clips.map(c => c.name).join(', ')}], fire="${fireClip?.name}", idle="${idleClip?.name}"`);

  weapon = { group: wrap, mixer, fireClip, idleClip, cooldown: 0 };
}

// muzzle flash (spawned manually since clip-driven flashes vary by rig)
const flashTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0,   'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,170,60,0.7)');
  grad.addColorStop(1,   'rgba(255,80,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: flashTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
flashSprite.scale.set(0.4, 0.4, 0.4);
flashSprite.position.set(0, -0.05, -0.7);
flashSprite.visible = false;
flashSprite.frustumCulled = false;
camera.add(flashSprite);

let flashTime = 0;

// --- attack ---------------------------------------------------------------

const raycaster = new THREE.Raycaster();

function attack(): void {
  if (!weapon || weapon.cooldown > 0) return;
  weapon.cooldown = FIRE_COOLDOWN;

  // muzzle flash
  flashSprite.visible = true;
  flashTime = 0.05;
  flashSprite.scale.setScalar(0.35 + Math.random() * 0.2);
  flashSprite.material.rotation = Math.random() * Math.PI;

  // fire animation
  if (weapon.mixer && weapon.fireClip) {
    const a = weapon.mixer.clipAction(weapon.fireClip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.reset().play();
  }

  // raycast against rocks AND monsters; pick the closer hit.
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  raycaster.set(origin, dir);
  raycaster.far = FIRE_RANGE;

  // collect potential targets
  const targets: THREE.Object3D[] = [];
  if (rockInstanced) targets.push(rockInstanced);
  for (const m of monsters) if (m.alive) targets.push(m.group);

  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length === 0) return;
  const hit = hits[0];

  // Was the hit on the rock InstancedMesh?
  if (hit.object === rockInstanced && hit.instanceId != null) {
    const target = rocks.find(r => r.slot === hit.instanceId && r.alive);
    if (target) shatterRock(target, hit.point);
    return;
  }
  // Otherwise, walk up the hit's parent chain to find which monster it belongs to.
  let node: THREE.Object3D | null = hit.object;
  while (node) {
    const m = monsters.find(x => x.group === node);
    if (m) {
      killMonster(m);
      return;
    }
    node = node.parent;
  }
}

function killMonster(m: Monster): void {
  if (!m.alive) return;
  m.alive = false;
  // simple "death": tip over and fade out via opacity.
  // For now, just remove from scene immediately.
  scene.remove(m.group);
  m.group.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
}

// --- player ---------------------------------------------------------------

interface Player {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  bobPhase: number;
}

const player: Player = {
  position: new THREE.Vector3(0, 0, 0), // set after asteroid loads
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  bobPhase: 0,
};

const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup',   (e) => keys.delete(e.code));

let firing = false;
window.addEventListener('mousedown', (e) => { if (e.button === 0) firing = true; });
window.addEventListener('mouseup',   (e) => { if (e.button === 0) firing = false; });

renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlayEl.style.display = locked ? 'none' : 'grid';
  console.log(`[pointerlock] ${locked ? 'ACQUIRED' : 'RELEASED'} at t=${performance.now().toFixed(0)}ms`);
});

document.addEventListener('pointerlockerror', () => {
  console.error('[pointerlock] error requesting lock');
});

window.addEventListener('error', (e) => {
  console.error('[window.error]', e.message, 'at', e.filename + ':' + e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.error('[webgl] context LOST — driver reset or GPU eviction');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.warn('[webgl] context RESTORED');
});

// Explicit ESC handling to log it
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') console.log('[esc] pressed');
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * MOUSE_SENS;
  player.pitch -= e.movementY * MOUSE_SENS;
  if (player.pitch >  PITCH_LIMIT) player.pitch =  PITCH_LIMIT;
  if (player.pitch < -PITCH_LIMIT) player.pitch = -PITCH_LIMIT;
});

startBtn.addEventListener('click', () => renderer.domElement.requestPointerLock());

function tickPlayer(dt: number): void {
  // Use position direction as "up" — works for roughly-spherical asteroid.
  const up = player.position.lengthSq() > 0.01 ? player.position.clone().normalize() : new THREE.Vector3(0, 1, 0);

  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(ref.dot(up)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
  const t1 = ref.clone().sub(up.clone().multiplyScalar(ref.dot(up))).normalize();
  const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

  const cosY = Math.cos(player.yaw);
  const sinY = Math.sin(player.yaw);
  const forward = t1.clone().multiplyScalar(cosY).addScaledVector(t2, sinY);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  let mvX = 0, mvZ = 0;
  if (keys.has('KeyW')) mvZ += 1;
  if (keys.has('KeyS')) mvZ -= 1;
  if (keys.has('KeyD')) mvX += 1;
  if (keys.has('KeyA')) mvX -= 1;
  const moving = mvX !== 0 || mvZ !== 0;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? SPRINT_SPEED : WALK_SPEED;

  const wishDir = forward.clone().multiplyScalar(mvZ).addScaledVector(right, mvX);
  if (wishDir.lengthSq() > 0) wishDir.normalize();

  const vUp = player.velocity.dot(up);
  const vTang = player.velocity.clone().addScaledVector(up, -vUp);
  vTang.lerp(wishDir.multiplyScalar(moving ? speed : 0), 1 - Math.exp(-12 * dt));

  let vUpNew = vUp - GRAVITY * dt;
  if (keys.has('Space') && player.grounded) {
    vUpNew = JUMP_SPEED;
    player.grounded = false;
  }
  player.velocity.copy(vTang).addScaledVector(up, vUpNew);
  player.position.addScaledVector(player.velocity, dt);

  // ground contact: exact raycast against the asteroid mesh — table lookup
  // would underestimate radius at convex spots and let the player clip in.
  const ground = findGroundExact(player.position);
  if (ground) {
    const playerR = player.position.length();
    const surfR = ground.point.length();
    const footR = surfR + PLAYER_RADIUS;
    if (playerR < footR) {
      player.position.copy(ground.up).multiplyScalar(footR);
      const inward = player.velocity.dot(ground.up);
      if (inward < 0) player.velocity.addScaledVector(ground.up, -inward);
      player.grounded = true;
    } else if (playerR > footR + 0.05) {
      player.grounded = false;
    }
  }

  if (player.grounded && moving) player.bobPhase += dt * (speed === SPRINT_SPEED ? 11 : 8);
  const bob = Math.sin(player.bobPhase) * (player.grounded && moving ? 0.04 : 0);

  const eyeUp = player.position.clone().normalize();
  camera.position.copy(player.position).addScaledVector(eyeUp, EYE_HEIGHT - PLAYER_RADIUS + bob);
  camera.up.copy(eyeUp);

  let ref2 = new THREE.Vector3(0, 0, 1);
  if (Math.abs(ref2.dot(eyeUp)) > 0.95) ref2 = new THREE.Vector3(1, 0, 0);
  const t1b = ref2.clone().sub(eyeUp.clone().multiplyScalar(ref2.dot(eyeUp))).normalize();
  const t2b = new THREE.Vector3().crossVectors(eyeUp, t1b).normalize();
  const forwardNow = t1b.clone().multiplyScalar(Math.cos(player.yaw))
    .addScaledVector(t2b, Math.sin(player.yaw));
  const rightNow = new THREE.Vector3().crossVectors(forwardNow, eyeUp).normalize();
  const lookDir = forwardNow.clone().applyAxisAngle(rightNow, player.pitch);
  camera.lookAt(camera.position.clone().add(lookDir));
}

function updateWeapon(dt: number): void {
  if (!weapon) return;
  if (weapon.cooldown > 0) weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  if (firing && weapon.cooldown <= 0) attack();
  if (weapon.mixer) weapon.mixer.update(dt);
}

// --- credits --------------------------------------------------------------

interface CreditsEntry { slug: string; name: string; author: string; license: string; source: string }

async function renderCredits(): Promise<void> {
  try {
    const res = await fetch(`${MODEL_BASE}CREDITS.json`);
    if (!res.ok) return;
    const all: CreditsEntry[] = await res.json();
    const used = all.filter(c => ['asteroid', 'rock', 'fps_rifle', 'monster'].includes(c.slug));
    if (used.length === 0) return;
    const escapeHtml = (s: string) =>
      s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
    const lines = used.map(c =>
      `<b>${escapeHtml(c.name)}</b> · ${escapeHtml(c.author)} · ${escapeHtml(c.license)} · <a href="${escapeHtml(c.source)}" target="_blank" rel="noopener">link</a>`
    );
    creditsEl.innerHTML = `Sketchfab assets:<br/>${lines.join('<br/>')}`;
  } catch { /* ignore */ }
}

// --- main loop ------------------------------------------------------------

const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  // Wrap the per-frame work in try/catch so a single transient error doesn't
  // halt the loop (which previously caused pointer lock release & a "kicked
  // back to menu" feel).
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    tickPlayer(dt);
    tickMonsters(dt);
    updateWeapon(dt);
    updateFragments(dt);

    if (flashTime > 0) {
      flashTime -= dt;
      if (flashTime <= 0) flashSprite.visible = false;
    }

    const aliveRocks = rocks.filter(r => r.alive).length;
    const aliveMonsters = monsters.filter(m => m.alive).length;
    infoEl.textContent = `monsters: ${aliveMonsters}/${monsters.length}  ·  rocks: ${aliveRocks}/${rocks.length}  ·  fragments: ${fragments.length}  ·  alt: ${(player.position.length() - asteroidBoundingRadius).toFixed(2)}`;

    renderer.render(scene, camera);
  } catch (e) {
    console.error('[animate]', e);
  }
}

// --- bootstrap ------------------------------------------------------------

async function step(label: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    console.log(`[boot] ${label} ...`);
    await fn();
    console.log(`[boot] ${label} OK`);
  } catch (e) {
    console.error(`[boot] ${label} FAILED:`, e);
  }
}

(async () => {
  renderCredits();
  await step('loadAsteroid', loadAsteroid);
  await step('buildSurfaceTable', () => buildSurfaceTable());
  player.position.set(0, asteroidBoundingRadius * 1.2, 0);
  await step('loadAndScatterRocks', loadAndScatterRocks);
  await step('loadMonsterTemplate', loadMonsterTemplate);
  await step('spawnInitialMonsters', spawnInitialMonsters);
  await step('loadWeapon', loadWeapon);
  animate();
})();
