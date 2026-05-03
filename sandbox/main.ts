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

const TARGET_PLANET_DIAMETER = 160;  // longest bbox dim of asteroid scaled to this many metres
const GRAVITY = 18;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 7;
const SPRINT_SPEED = 12;
const JUMP_SPEED = 9;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const ROCK_COUNT = 50;
const MONSTER_INITIAL = 6;
const MONSTER_MAX_ALIVE = 50;
const MONSTER_SPAWN_INTERVAL = 6.0;     // seconds between trickle spawns
const MONSTER_SPAWN_PLAYER_DOT = 0.6;   // reject spawn dirs within ~53° of player view (avoid pop-in)
const MONSTER_SPEED = 2.2;       // m/s along the surface (walkers)
const MONSTER_HEIGHT = 1.8;      // walker target height in metres after scaling
const MONSTER_TOUCH_DIST = 1.4;  // when within this, walker stops (touched player)
const FLIER_HEIGHT = 1.6;        // flier target size (longest axis) in metres
const FLIER_HOVER_DIST = 14;     // engage at this many metres horizontally from player
const FLIER_HOVER_ALT = 8;       // hover this high above local surface
const FLIER_SPEED = 4;           // m/s
const FLIER_FIRE_INTERVAL = 2.4; // seconds between projectile shots
const FLIER_PROJECTILE_SPEED = 18; // m/s
const FLIER_FIRE_RANGE = 35;     // start firing inside this distance
const FLIER_SPAWN_FRACTION = 0.35; // ~35% of trickle-spawns are fliers
const PROJECTILE_HIT_DIST = 1.4; // player gets hit if a projectile passes within
// HP per kind. Walkers tankier than fliers.
const WALKER_MAX_HP = 4;
const FLIER_MAX_HP = 2;

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

  // CRITICAL: force-update the entire wrap → root → mesh chain so that
  // matrixWorld on every descendant reflects the new scale. Three.js does
  // not propagate this automatically until the next render(). Without this,
  // raycasts run in glb-local coordinates (asteroid appears tiny — props
  // & monsters spawn near origin, INSIDE the visual surface).
  wrap.updateMatrixWorld(true);

  // Bounding radius in world units — m.matrixWorld now bakes in the scale.
  let maxRsq = 0;
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
  asteroidBoundingRadius = Math.sqrt(maxRsq);
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

// --- damage flash (cosmetic only — no actual HP) --------------------------

// Red radial vignette that pulses when a monster attacks the player. The
// container is fixed full-screen, transparent in the centre, red at the
// edges; opacity is animated each frame.
const damageEdgeEl = document.createElement('div');
damageEdgeEl.style.position = 'fixed';
damageEdgeEl.style.inset = '0';
damageEdgeEl.style.pointerEvents = 'none';
damageEdgeEl.style.zIndex = '5';
damageEdgeEl.style.background =
  'radial-gradient(ellipse at center, rgba(255,0,0,0) 30%, rgba(180,0,0,0.45) 70%, rgba(220,0,0,0.85) 100%)';
damageEdgeEl.style.opacity = '0';
document.body.appendChild(damageEdgeEl);

let damageFlash = 0; // 0..1; decays over ~0.6s

function flashDamage(): void {
  damageFlash = 1.0;
}

function updateDamageFlash(dt: number): void {
  if (damageFlash > 0) {
    damageFlash = Math.max(0, damageFlash - dt * 1.6);
    damageEdgeEl.style.opacity = damageFlash.toFixed(3);
  }
}

// --- HP bar (canvas-textured sprite) --------------------------------------

const HP_BAR_W = 0.9;
const HP_BAR_H = 0.12;

function drawHpBar(canvas: HTMLCanvasElement, ratio: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  // background
  ctx.fillStyle = 'rgba(15,18,28,0.85)';
  ctx.fillRect(0, 0, w, h);
  // border
  ctx.strokeStyle = '#cfd8e3';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  // fill
  let color = '#33cc44';
  if (ratio <= 0.66) color = '#ffa030';
  if (ratio <= 0.33) color = '#dd2222';
  ctx.fillStyle = color;
  const fillW = Math.max(0, Math.min(w - 6, (w - 6) * ratio));
  ctx.fillRect(3, 3, fillW, h - 6);
}

function makeHpBar(): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 28;
  drawHpBar(canvas, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(HP_BAR_W, HP_BAR_H, 1);
  sprite.renderOrder = 999; // on top of world
  return { sprite, canvas, texture };
}

// --- plasma projectiles (fired by fliers) --------------------------------

interface Projectile {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const projectiles: Projectile[] = [];

function fireProjectile(from: THREE.Vector3, target: THREE.Vector3): void {
  const dir = target.clone().sub(from).normalize();
  const geom = new THREE.SphereGeometry(0.30, 14, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88c8ff,
    emissive: 0x4080ff,
    emissiveIntensity: 2.0,
    roughness: 0.25,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(from);
  scene.add(mesh);

  const light = new THREE.PointLight(0x60a0ff, 2.0, 6, 1.5);
  mesh.add(light);

  projectiles.push({
    mesh, light,
    velocity: dir.multiplyScalar(FLIER_PROJECTILE_SPEED),
    life: 0,
    maxLife: 4.0,
  });
}

function disposeProjectile(p: Projectile): void {
  scene.remove(p.mesh);
  p.mesh.geometry.dispose();
  (p.mesh.material as THREE.Material).dispose();
}

function tickProjectiles(dt: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life += dt;

    // collision with player
    const dist = p.mesh.position.distanceTo(player.position);
    if (dist < PROJECTILE_HIT_DIST) {
      flashDamage();
      disposeProjectile(p);
      projectiles.splice(i, 1);
      continue;
    }
    if (p.life >= p.maxLife) {
      disposeProjectile(p);
      projectiles.splice(i, 1);
    }
  }
}

// --- monsters -------------------------------------------------------------

interface MonsterVariant {
  /** Top-level subtree (one zombie's worth of meshes & bones) */
  root: THREE.Object3D;
  scale: number;
  baseY: number;
  centerXZ: { x: number; z: number };
}

interface MonsterTemplate {
  variants: MonsterVariant[];   // 1+ — for packs we pick a random variant per spawn
  clips: THREE.AnimationClip[];
  walkClipName?: string;
  attackClipName?: string;
  deathClipName?: string;
}

let monsterTemplate: MonsterTemplate | null = null;
let flierTemplate: MonsterTemplate | null = null;

type MonsterKind = 'walker' | 'flier';
type MonsterState = 'walking' | 'attacking' | 'dying';

interface Monster {
  kind: MonsterKind;
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walkAction: THREE.AnimationAction | null;
  attackAction: THREE.AnimationAction | null;
  deathAction: THREE.AnimationAction | null;
  state: MonsterState;
  attackCooldown: number;
  fireCooldown: number;          // fliers only
  /** Frame counter for animation LOD (0 = full update this frame). */
  _mixerSkip?: number;
  hp: number;
  maxHp: number;
  hpBar: THREE.Sprite;
  hpBarCanvas: HTMLCanvasElement;
  hpBarTexture: THREE.CanvasTexture;
  hpRatioDrawn: number;          // last drawn ratio; only redraw on change
  /** Time remaining in the death animation before despawn (0 = not dying). */
  dyingTimer: number;
  /**
   * For walkers: foot position on the asteroid surface.
   * For fliers: the wyvern's body position in space (above the surface).
   */
  position: THREE.Vector3;
  alive: boolean;
}

const monsters: Monster[] = [];

async function loadMonsterTemplate(): Promise<void> {
  monsterTemplate = await loadCreatureTemplate('monster.glb', MONSTER_HEIGHT, 'walker');
  flierTemplate  = await loadCreatureTemplate('flier.glb',   FLIER_HEIGHT,   'flier');
}

async function loadCreatureTemplate(
  filename: string,
  targetHeight: number,
  label: string,
): Promise<MonsterTemplate | null> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}${filename}`); }
  catch (e) { console.warn(`[${label}] load failed:`, e); return null; }

  const root = gltf.scene;

  // Use the whole scene as a single variant. This works for single-character
  // glbs (which is what we're using). Pack splitting was attempted earlier
  // but breaks when a single combined animation references bones from
  // multiple characters — extracting one character leaves clip tracks that
  // can't bind, then three's mixer chokes on undefined node references.
  const variantNodes: THREE.Object3D[] = [root];

  // Compute bbox/scale/center for each variant (just the one for now).
  const variants: MonsterVariant[] = [];
  for (const node of variantNodes) {
    node.updateMatrixWorld(true);
    const bbox = meshOnlyBbox(node);
    if (bbox.isEmpty()) continue;
    const size = new THREE.Vector3(); bbox.getSize(size);
    const center = new THREE.Vector3(); bbox.getCenter(center);
    const heightAxis = Math.max(size.x, size.y, size.z);
    const scale = targetHeight / (heightAxis || 1);
    variants.push({
      root: node,
      scale,
      baseY: -bbox.min.y,
      centerXZ: { x: center.x, z: center.z },
    });
  }

  // Apply material tweaks ONCE on the template — these are the same materials
  // that all spawned instances share, which is the whole point: one shader
  // program, one GPU upload. Cloning per-spawn (the previous approach) blew
  // up draw calls and forced extra shader prep on every spawn.
  for (const v of variants) {
    v.root.traverse(c => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (sm.opacity != null && sm.opacity < 1) sm.opacity = 1;
        // Untextured near-white default: tint to a creature colour so it
        // doesn't render as bright white against the asteroid.
        if (sm.color && !sm.map && sm.color.r > 0.85 && sm.color.g > 0.85 && sm.color.b > 0.85) {
          sm.color.setHex(label === 'flier' ? 0x6a4d8c : 0x536b3a);
          sm.roughness = Math.max(0.7, sm.roughness ?? 0.7);
          sm.metalness = 0;
          sm.envMapIntensity = 0.3;
        }
      }
    });
  }

  const tpl: MonsterTemplate = {
    variants,
    clips: gltf.animations,
    walkClipName: gltf.animations.find(c => /walk|run|move|fly|hover/i.test(c.name))?.name
                ?? gltf.animations[0]?.name,
    attackClipName: gltf.animations.find(c => /attack|swing|hit|bite|claw|punch|fire|shoot/i.test(c.name))?.name,
    deathClipName:  gltf.animations.find(c => /die|death|dead|fall|kill/i.test(c.name))?.name,
  };
  console.log(`[${label}] template loaded:
  variants: ${variants.length}
  scales: [${variants.map(v => v.scale.toFixed(2)).join(', ')}]
  clips: [${gltf.animations.map(c => `${c.name}/${c.duration.toFixed(2)}s`).join(', ')}]
  walk:   "${tpl.walkClipName}"
  attack: "${tpl.attackClipName}"
  death:  "${tpl.deathClipName}"`);
  return tpl;
}

function spawnMonster(dir: THREE.Vector3, kind: MonsterKind = 'walker'): void {
  const tpl = kind === 'flier' ? flierTemplate : monsterTemplate;
  if (!tpl || tpl.variants.length === 0) return;

  // Pick a random variant from the pack.
  const variant = tpl.variants[Math.floor(Math.random() * tpl.variants.length)];

  // SkeletonUtils.clone preserves the skeleton — plain clone() shares bones,
  // which causes all monsters to animate in lockstep.
  const inst = cloneSkeleton(variant.root) as THREE.Object3D;

  // Hierarchy: wrap (world position + scale + lookAt rotation) ← inst.
  // Centering offset sits on inst (in glb units, before scale).
  inst.position.set(-variant.centerXZ.x, variant.baseY, -variant.centerXZ.z);

  const wrap = new THREE.Group();
  wrap.add(inst);
  wrap.scale.setScalar(variant.scale);

  // Force every node visible & uncullable. Frustum culling on skinned meshes
  // can drop the mesh when bones move outside the bind-pose bbox, causing
  // pop-in/out during animation. Materials & textures are shared with the
  // template (set up once in loadCreatureTemplate) — that's the perf win.
  wrap.traverse(c => {
    c.visible = true;
    c.frustumCulled = false;
  });

  // Initial position: walkers on surface, fliers a bit above the surface.
  const surf = asteroidSurfacePoint(dir);
  const surfacePoint = surf ?? dir.clone().multiplyScalar(asteroidBoundingRadius);
  const surfaceUp = surfacePoint.clone().normalize();
  const position = kind === 'flier'
    ? surfacePoint.clone().addScaledVector(surfaceUp, FLIER_HOVER_ALT * 1.4) // start above hover altitude, glides down
    : surfacePoint;
  wrap.position.copy(position);
  wrap.up.copy(surfaceUp);
  scene.add(wrap);

  const mixer = new THREE.AnimationMixer(inst);
  let walkAction: THREE.AnimationAction | null = null;
  if (tpl.walkClipName) {
    const clip = tpl.clips.find(c => c.name === tpl.walkClipName);
    if (clip) {
      walkAction = mixer.clipAction(clip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.time = Math.random() * clip.duration;
      walkAction.play();
    }
  }

  // HP bar (sprite, world-space; positioned each frame above the body)
  const { sprite: hpBar, canvas: hpBarCanvas, texture: hpBarTexture } = makeHpBar();
  scene.add(hpBar);

  const maxHp = kind === 'flier' ? FLIER_MAX_HP : WALKER_MAX_HP;
  monsters.push({
    kind,
    group: wrap, mixer,
    walkAction,
    attackAction: null,
    deathAction: null,
    state: 'walking',
    attackCooldown: 0,
    fireCooldown: kind === 'flier' ? 1.5 + Math.random() * 1.5 : 0,
    hp: maxHp,
    maxHp,
    hpBar, hpBarCanvas, hpBarTexture,
    hpRatioDrawn: 1,
    dyingTimer: 0,
    position,
    alive: true,
  });
}

async function spawnInitialMonsters(): Promise<void> {
  if (!monsterTemplate) return;
  let placed = 0, attempts = 0;
  while (placed < MONSTER_INITIAL && attempts < MONSTER_INITIAL * 4) {
    attempts++;
    const dir = new THREE.Vector3().randomDirection();
    const surf = asteroidSurfacePoint(dir);
    if (!surf) continue;
    spawnMonster(dir);
    placed++;
  }
  console.log(`[monster] initial spawn ${placed}/${MONSTER_INITIAL}`);
}

/**
 * Trickle-spawn new monsters over time up to MONSTER_MAX_ALIVE. Random
 * direction, but rejected if it would pop in front of the player. Mix of
 * walkers and fliers controlled by FLIER_SPAWN_FRACTION.
 */
let spawnAccumulator = 0;
function tickMonsterSpawner(dt: number): void {
  if (!monsterTemplate && !flierTemplate) return;
  spawnAccumulator += dt;
  if (spawnAccumulator < MONSTER_SPAWN_INTERVAL) return;
  spawnAccumulator = 0;

  const aliveCount = monsters.filter(m => m.alive).length;
  if (aliveCount >= MONSTER_MAX_ALIVE) return;

  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  let dir: THREE.Vector3 | null = null;
  for (let i = 0; i < 16; i++) {
    const candidate = new THREE.Vector3().randomDirection();
    const spawnPoint = candidate.clone().normalize().multiplyScalar(asteroidBoundingRadius);
    const toSpawn = spawnPoint.sub(player.position).normalize();
    if (toSpawn.dot(camForward) < MONSTER_SPAWN_PLAYER_DOT) {
      dir = candidate;
      break;
    }
  }
  if (!dir) return;

  // Pick walker vs flier — bias toward walkers; only spawn flier if its
  // template loaded successfully.
  const wantFlier = flierTemplate && Math.random() < FLIER_SPAWN_FRACTION;
  spawnMonster(dir, wantFlier ? 'flier' : 'walker');
}

const ATTACK_RANGE = 1.6;        // start attacking when within this distance
const ATTACK_INTERVAL = 1.4;     // seconds between hits

/**
 * Switch monster to a new animation state by crossfading clips. A monster
 * has up to three clip slots (walk, attack, death); only one plays at a time.
 */
function setMonsterState(m: Monster, state: MonsterState): void {
  if (m.state === state) return;
  m.state = state;

  // fade everything out, then fade in the relevant one
  if (m.walkAction)   m.walkAction.fadeOut(0.15);
  if (m.attackAction) m.attackAction.fadeOut(0.15);
  if (m.deathAction)  m.deathAction.fadeOut(0.15);

  if (state === 'walking' && m.walkAction) {
    m.walkAction.reset().fadeIn(0.15).play();
    m.walkAction.setLoop(THREE.LoopRepeat, Infinity);
  } else if (state === 'attacking' && m.attackAction) {
    m.attackAction.reset().fadeIn(0.1).play();
    m.attackAction.setLoop(THREE.LoopRepeat, Infinity);
  } else if (state === 'dying' && m.deathAction) {
    m.deathAction.reset().fadeIn(0.05).play();
    m.deathAction.setLoop(THREE.LoopOnce, 1);
    m.deathAction.clampWhenFinished = true;
  }
}

function templateFor(m: Monster): MonsterTemplate | null {
  return m.kind === 'flier' ? flierTemplate : monsterTemplate;
}

function tickMonsters(dt: number): void {
  for (let i = monsters.length - 1; i >= 0; i--) {
    const m = monsters[i];
    const tpl = templateFor(m);

    // Lazy-bind attack/death actions
    if (!m.attackAction && tpl?.attackClipName) {
      const clip = tpl.clips.find(c => c.name === tpl.attackClipName);
      if (clip) m.attackAction = m.mixer.clipAction(clip);
    }
    if (!m.deathAction && tpl?.deathClipName) {
      const clip = tpl.clips.find(c => c.name === tpl.deathClipName);
      if (clip) m.deathAction = m.mixer.clipAction(clip);
    }

    // Animation LOD: monsters far from the player update their skeleton at
    // a reduced rate. Close → full 60fps animation, far → 1/4 rate. Skinned
    // mesh skeleton math is the dominant CPU cost when there are many of them.
    const distSq = m.position.distanceToSquared(player.position);
    let mixerDt = dt;
    if (distSq > 80 * 80) {
      // very far: every 4th frame
      m._mixerSkip = ((m._mixerSkip ?? 0) + 1) % 4;
      mixerDt = m._mixerSkip === 0 ? dt * 4 : 0;
    } else if (distSq > 30 * 30) {
      // mid: every other frame
      m._mixerSkip = ((m._mixerSkip ?? 0) + 1) % 2;
      mixerDt = m._mixerSkip === 0 ? dt * 2 : 0;
    }
    if (mixerDt > 0) m.mixer.update(mixerDt);

    if (m.state === 'dying') {
      m.dyingTimer -= dt;
      if (m.dyingTimer <= 0) {
        despawnMonster(m, i);
      }
      continue;
    }

    if (!m.alive) continue;

    if (m.kind === 'flier') tickFlier(m, dt);
    else                    tickWalker(m, dt);

    // HP bar position + redraw if changed
    tickHpBar(m);
  }
}

function tickWalker(m: Monster, dt: number): void {
  const toPlayer = player.position.clone().sub(m.position);
  const dist = toPlayer.length();

  if (m.attackCooldown > 0) m.attackCooldown -= dt;

  if (dist <= ATTACK_RANGE) {
    setMonsterState(m, 'attacking');
    if (m.attackCooldown <= 0) {
      m.attackCooldown = ATTACK_INTERVAL;
      flashDamage();
    }
  } else {
    setMonsterState(m, 'walking');
    const up = m.position.clone().normalize();
    const tangent = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
    if (tangent.lengthSq() > 1e-6) {
      tangent.normalize();
      m.position.addScaledVector(tangent, MONSTER_SPEED * dt);
      const newUp = m.position.clone().normalize();
      const r = getSurfaceRadius(newUp);
      m.position.copy(newUp).multiplyScalar(r);
    }
  }

  // Orient: stand up, face the player.
  const stand = m.position.clone().normalize();
  m.group.position.copy(m.position);
  m.group.up.copy(stand);
  m.group.lookAt(m.position.clone().add(toPlayer));
}

function tickFlier(m: Monster, dt: number): void {
  // Compute the local "up" at the flier's position and its altitude above
  // the asteroid surface in that direction.
  const up = m.position.clone().normalize();
  const surfR = getSurfaceRadius(up);
  const altitude = m.position.length() - surfR;

  const toPlayer = player.position.clone().sub(m.position);
  const dist = toPlayer.length();

  // Move to maintain hover distance from player on the asteroid surface
  // tangent plane.
  const tangentToPlayer = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
  const tangentDist = tangentToPlayer.length();
  if (tangentDist > 1e-3) tangentToPlayer.divideScalar(tangentDist);

  // horizontal: close to FLIER_HOVER_DIST
  if (tangentDist > FLIER_HOVER_DIST + 1) {
    m.position.addScaledVector(tangentToPlayer, FLIER_SPEED * dt);
  } else if (tangentDist < FLIER_HOVER_DIST - 1) {
    m.position.addScaledVector(tangentToPlayer, -FLIER_SPEED * dt * 0.5); // back off slower
  }

  // vertical: settle to FLIER_HOVER_ALT above the surface
  const altErr = altitude - FLIER_HOVER_ALT;
  if (Math.abs(altErr) > 0.3) {
    m.position.addScaledVector(up, -Math.sign(altErr) * FLIER_SPEED * 0.6 * dt);
  }

  // gentle bob so it doesn't feel like a static prop
  m.position.addScaledVector(up, Math.sin(performance.now() * 0.002 + m.fireCooldown) * 0.02);

  // Fire plasma at the player periodically when in range
  m.fireCooldown -= dt;
  if (dist < FLIER_FIRE_RANGE && m.fireCooldown <= 0) {
    fireProjectile(m.position.clone(), player.position.clone());
    m.fireCooldown = FLIER_FIRE_INTERVAL;
  }

  // Orient (use the local surface normal as up, look at the player).
  m.group.position.copy(m.position);
  m.group.up.copy(up);
  m.group.lookAt(player.position);
}

function despawnMonster(m: Monster, i?: number): void {
  scene.remove(m.group);
  scene.remove(m.hpBar);
  m.hpBarTexture.dispose();
  (m.hpBar.material as THREE.SpriteMaterial).dispose();
  m.group.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
  const idx = i ?? monsters.indexOf(m);
  if (idx >= 0) monsters.splice(idx, 1);
}

function tickHpBar(m: Monster): void {
  const ratio = Math.max(0, m.hp / m.maxHp);
  if (Math.abs(ratio - m.hpRatioDrawn) > 0.005) {
    drawHpBar(m.hpBarCanvas, ratio);
    m.hpBarTexture.needsUpdate = true;
    m.hpRatioDrawn = ratio;
  }
  // position the bar above the creature
  const up = m.position.clone().normalize();
  const offset = m.kind === 'flier' ? 1.0 : 2.4;
  m.hpBar.position.copy(m.position).addScaledVector(up, offset);
  // hide once dead/dying
  m.hpBar.visible = m.alive;
}

// --- weapon (FPS rig glb with arms + animations) --------------------------

type WeaponPrimary = 'drawing' | 'idle' | 'running' | 'firing' | 'reloading';

interface WeaponState {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  // Clip slots (any may be null if the glb didn't include that motion).
  drawAction:   THREE.AnimationAction | null;
  idleAction:   THREE.AnimationAction | null;
  runAction:    THREE.AnimationAction | null;
  fireAction:   THREE.AnimationAction | null;
  reloadAction: THREE.AnimationAction | null;
  // Active animation state. The primary action plays on the mixer; transient
  // states (drawing/firing/reloading) override the base for `primaryTimer`
  // seconds, then we fall back to idle or running based on movement.
  primary: WeaponPrimary;
  primaryAction: THREE.AnimationAction | null;
  primaryTimer: number;
  // Cooldowns / magazine.
  cooldown: number;
  ammo: number;
  reloading: boolean;
  recoil: number;          // procedural recoil only used when no fireAction
}

let weapon: WeaponState | null = null;
let FIRE_COOLDOWN = 0.10;        // overwritten by Shoot clip duration once weapon loads
const FIRE_RANGE = 200;
const MAG_SIZE = 30;
const RELOAD_TIME = 2.0;  // seconds to reload (clip duration overrides this when available)

async function loadWeapon(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}fps_rifle.glb`); }
  catch (e) { console.error('[weapon] load failed:', e); return; }

  const inner = gltf.scene;

  // The bind-pose bbox of an FPS arms rig is dominated by outstretched
  // arms (T-pose), not the rifle. Find the actual rifle mesh and size by
  // its longest axis instead, so the gameplay-pose rig renders at a
  // predictable on-screen size.
  const tmpRoot = new THREE.Group();
  tmpRoot.add(inner);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);

  // Find the rifle mesh. The rig likely has the Skinned arms+rifle as one
  // SkinnedMesh and individual props as separate meshes — we want the
  // weapon, which by name matching OR by being the LARGEST non-arms mesh
  // is a good heuristic. Also dump every mesh to the console so we can see.
  let rifleMaxDim = 0;
  const meshLog: string[] = [];
  inner.traverse(c => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    if (!b) return;
    const s = new THREE.Vector3(); b.getSize(s);
    const matName = (m.material as { name?: string } | null)?.name ?? '';
    const combinedName = `${m.name} ${matName}`.toLowerCase();
    const meshMax = Math.max(s.x, s.y, s.z);
    meshLog.push(`    "${m.name}" mat="${matName}" size=${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`);
    // Match weapon parts (rifle/gun/AKM names or material naming).
    const isWeapon = /rifle|gun|weapon|akm|m4|ak|ar15|main_|vector|pmag|silencer|scope|barrel/.test(combinedName);
    // Skip arm/glove/skin meshes
    const isArm = /arm|hand|glove|skin|finger/.test(combinedName);
    if (isArm) return;
    if (isWeapon) {
      rifleMaxDim = Math.max(rifleMaxDim, meshMax);
    }
  });
  // If still 0, fall back to the largest non-arm mesh
  if (rifleMaxDim === 0) {
    inner.traverse(c => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const matName = (m.material as { name?: string } | null)?.name ?? '';
      if (/arm|hand|glove|skin|finger/i.test(`${m.name} ${matName}`)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      if (!b) return;
      const s = new THREE.Vector3(); b.getSize(s);
      rifleMaxDim = Math.max(rifleMaxDim, s.x, s.y, s.z);
    });
  }

  const targetSize = 1.0;
  const scale = rifleMaxDim > 0
    ? targetSize / rifleMaxDim
    : targetSize / (Math.max(size.x, size.y, size.z) || 1);

  // Centre the rig on the wrap origin. In bind-pose the bbox-centre falls
  // somewhere in the middle of the figure, but in idle-pose the rifle ends
  // up offset from there (typically held forward+up of the body's centre).
  // We compensate via wrap.position — moving the wrap UP brings the rifle
  // into the camera's view.
  inner.position.set(-center.x, -center.y, -center.z);
  const wrap = new THREE.Group();
  wrap.add(inner);

  wrap.scale.setScalar(scale);
  wrap.rotation.set(0, Math.PI, 0);
  // Empirically tuned to put the held rifle in the lower-right of view
  // for the Cransh "FPS hands rifle pack". If still off, adjust Y/Z.
  wrap.position.set(0, 0.45, -0.50);
  wrap.traverse(c => {
    c.visible = true;
    c.frustumCulled = false;
  });
  camera.add(wrap);

  // animations
  const clips = gltf.animations;
  const mixer = clips.length > 0 ? new THREE.AnimationMixer(inner) : null;

  // Pick clips by name. The Cransh pack uses "Arms_FPS_Anim_<Action>" naming
  // — names like "Arms_FPS_Anim_Idle" lowercase are "arms_fps_anim_idle", so
  // \bidle\b doesn't match (the underscore is a word char, no boundary).
  // Just substring-match. Exclude "OneShot" from the fire pick — user wants
  // the looping "Shoot" for sustained fire.
  const findClip = (re: RegExp, exclude?: RegExp) =>
    clips.find(c => re.test(c.name.toLowerCase()) && !(exclude && exclude.test(c.name.toLowerCase()))) ?? null;

  const drawClip   = findClip(/draw/);
  const idleClip   = findClip(/idle|rest/) ?? (clips.length === 1 ? clips[0] : null);
  const runClip    = findClip(/run|sprint/);
  const fireClip   = findClip(/shoot|fire/, /oneshot|aim/);
  const reloadClip = findClip(/reload/);

  const makeAction = (clip: THREE.AnimationClip | null, loop: boolean): THREE.AnimationAction | null => {
    if (!mixer || !clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = false;
    return a;
  };

  // Shoot LOOPS — every clip iteration is one shot. User asked for this so
  // sustained fire shows continuous animation rather than re-triggering.
  const drawAction   = makeAction(drawClip,   false);
  const idleAction   = makeAction(idleClip,   true);
  const runAction    = makeAction(runClip,    true);
  const fireAction   = makeAction(fireClip,   true);
  const reloadAction = makeAction(reloadClip, false);

  // Tie the firing-rate to the actual Shoot clip duration so visual loop and
  // game-logic ticks stay in sync.
  if (fireClip && fireClip.duration > 0.02) FIRE_COOLDOWN = fireClip.duration;

  console.log(`[weapon] loaded:
  bind-pose bbox: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} (glb units)
  rifle mesh max dim: ${rifleMaxDim.toFixed(2)} | applied scale: ${scale.toFixed(4)}
  meshes:
${meshLog.join('\n')}
  draw="${drawClip?.name}" idle="${idleClip?.name}" run="${runClip?.name}" fire="${fireClip?.name}" reload="${reloadClip?.name}"
  FIRE_COOLDOWN=${FIRE_COOLDOWN.toFixed(3)}s`);

  weapon = {
    group: wrap, mixer,
    drawAction, idleAction, runAction, fireAction, reloadAction,
    primary: 'drawing',
    primaryAction: null,
    primaryTimer: 0,
    cooldown: 0,
    ammo: MAG_SIZE,
    reloading: false,
    recoil: 0,
  };

  // Kick off the Draw animation immediately. After it finishes, the state
  // machine in updateWeapon will fall back to idle (or running).
  if (drawAction) {
    transitionPrimary(weapon, 'drawing');
  } else {
    transitionPrimary(weapon, 'idle');
  }
}

/**
 * Cross-fade the weapon's primary action to the one matching `primary`.
 * One-shot states (drawing/reloading) set primaryTimer to the clip's
 * duration so updateWeapon knows when to fall back to the base.
 */
function transitionPrimary(w: WeaponState, primary: WeaponPrimary): void {
  if (w.primary === primary) return;
  let action: THREE.AnimationAction | null = null;
  switch (primary) {
    case 'drawing':   action = w.drawAction;   break;
    case 'idle':      action = w.idleAction;   break;
    case 'running':   action = w.runAction ?? w.idleAction; break;
    case 'firing':    action = w.fireAction;   break;
    case 'reloading': action = w.reloadAction; break;
  }
  w.primary = primary;
  if (!action) {
    w.primaryAction = null;
    w.primaryTimer = 0;
    return;
  }
  if (w.primaryAction && w.primaryAction !== action) {
    w.primaryAction.fadeOut(0.12);
  }
  action.reset();
  action.fadeIn(0.12);
  action.play();
  w.primaryAction = action;
  // For one-shot states, remember how long the clip runs.
  const oneShot = primary === 'drawing' || primary === 'reloading';
  w.primaryTimer = oneShot ? action.getClip().duration : 0;
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

// --- ammo HUD + reload ----------------------------------------------------

const ammoHudEl = document.createElement('div');
ammoHudEl.style.position = 'fixed';
ammoHudEl.style.right = '14px';
ammoHudEl.style.bottom = '14px';
ammoHudEl.style.font = '600 22px/1 ui-monospace, monospace';
ammoHudEl.style.color = '#cfd8e3';
ammoHudEl.style.background = 'rgba(0,0,0,0.45)';
ammoHudEl.style.padding = '8px 14px';
ammoHudEl.style.borderRadius = '6px';
ammoHudEl.style.pointerEvents = 'none';
ammoHudEl.style.minWidth = '70px';
ammoHudEl.style.textAlign = 'right';
ammoHudEl.textContent = `${MAG_SIZE} / ${MAG_SIZE}`;
document.body.appendChild(ammoHudEl);

function updateAmmoHud(): void {
  if (!weapon) return;
  if (weapon.reloading) {
    ammoHudEl.textContent = 'RELOADING...';
    ammoHudEl.style.color = '#ffa030';
  } else {
    ammoHudEl.textContent = `${weapon.ammo} / ${MAG_SIZE}`;
    ammoHudEl.style.color = weapon.ammo <= 5 ? '#dd2222' : '#cfd8e3';
  }
}

function startReload(): void {
  if (!weapon || weapon.reloading || weapon.ammo === MAG_SIZE) return;
  // Don't reload while the Draw is still playing.
  if (weapon.primary === 'drawing' && weapon.primaryTimer > 0) return;
  weapon.reloading = true;
  transitionPrimary(weapon, 'reloading');
  // If there's no reload clip we still need a sane timer so ammo refills.
  if (!weapon.reloadAction) weapon.primaryTimer = RELOAD_TIME;
  updateAmmoHud();
}

// --- attack ---------------------------------------------------------------

const raycaster = new THREE.Raycaster();

function attack(): void {
  if (!weapon || weapon.cooldown > 0) return;
  if (weapon.reloading) return;
  if (weapon.primary === 'drawing' && weapon.primaryTimer > 0) return;
  if (weapon.ammo <= 0) {
    startReload();
    return;
  }
  weapon.cooldown = FIRE_COOLDOWN;
  weapon.ammo -= 1;
  updateAmmoHud();

  // muzzle flash
  flashSprite.visible = true;
  flashTime = 0.05;
  flashSprite.scale.setScalar(0.35 + Math.random() * 0.2);
  flashSprite.material.rotation = Math.random() * Math.PI;

  // Procedural recoil only when there's no Shoot clip — with a clip the
  // looping animation already handles the visual.
  if (!weapon.fireAction) weapon.recoil = 1;

  if (weapon.ammo === 0) startReload();

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
      damageMonster(m, hit.point);
      return;
    }
    node = node.parent;
  }
}

/**
 * Bullet hit. Decrement HP; if it falls to zero, trigger death.
 *  - Walkers prefer the death animation if available; else shatter.
 *  - Fliers always shatter (per request — no death anim needed).
 */
function damageMonster(m: Monster, hitPoint: THREE.Vector3): void {
  if (!m.alive) return;
  m.hp -= 1;
  if (m.hp > 0) return; // still alive — HP bar will reflect new ratio next tick

  m.alive = false;

  if (m.kind === 'flier') {
    shatterMonster(m, hitPoint);
    return;
  }

  // Walker: try the death animation first, fall back to shatter.
  const tpl = templateFor(m);
  if (!m.deathAction && tpl?.deathClipName) {
    const clip = tpl.clips.find(c => c.name === tpl.deathClipName);
    if (clip) m.deathAction = m.mixer.clipAction(clip);
  }

  if (m.deathAction) {
    setMonsterState(m, 'dying');
    const clipLen = m.deathAction.getClip().duration;
    m.dyingTimer = clipLen + 1.0;
    m.hpBar.visible = false;
  } else {
    shatterMonster(m, hitPoint);
  }
}

/**
 * Shatter a monster into per-triangle fragments. Uses bind-pose vertex
 * positions (current bone deformation isn't applied — would require
 * SkinnedMesh.applyBoneTransform per-vertex, which is fine but adds cost).
 * For a fast death effect this is plenty close.
 */
function shatterMonster(m: Monster, hitPoint: THREE.Vector3): void {
  m.group.updateMatrixWorld(true);

  type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mat: THREE.Material };
  const tris: Tri[] = [];

  m.group.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const m2w = mesh.matrixWorld;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    for (let t = 0; t < triCount; t++) {
      const ai = idx ? idx.getX(t * 3)     : t * 3;
      const bi = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ci = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, ai).applyMatrix4(m2w);
      const b = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(m2w);
      const c2 = new THREE.Vector3().fromBufferAttribute(pos, ci).applyMatrix4(m2w);
      tris.push({ a, b, c: c2, mat });
    }
  });

  // Remove the monster (and its hp bar) immediately.
  despawnMonster(m);

  // Emit fragments (subsampled).
  const step = Math.max(1, Math.ceil(tris.length / FRAG_MAX_PER_SHATTER));
  for (let i = 0; i < tris.length; i += step) {
    const { a, b, c, mat } = tris[i];
    const center = a.clone().add(b).add(c).divideScalar(3);

    const fragGeom = new THREE.BufferGeometry();
    fragGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x - center.x, a.y - center.y, a.z - center.z,
      b.x - center.x, b.y - center.y, b.z - center.z,
      c.x - center.x, c.y - center.y, c.z - center.z,
    ], 3));
    fragGeom.computeVertexNormals();

    const sm = mat as THREE.MeshStandardMaterial;
    const fragMat = new THREE.MeshStandardMaterial({
      color: sm.color ? sm.color.clone() : new THREE.Color(0x886666),
      roughness: sm.roughness ?? 0.85,
      metalness: sm.metalness ?? 0,
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
    const speed = 5 + Math.random() * 5;
    const velocity = outward.multiplyScalar(speed);
    velocity.x += (Math.random() - 0.5) * 2;
    velocity.y += (Math.random() - 0.5) * 2;
    velocity.z += (Math.random() - 0.5) * 2;

    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    );

    scene.add(fragMesh);
    fragments.push({ mesh: fragMesh, velocity, angVel, life: 0, maxLife: FRAG_LIFE });
  }
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
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
});
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
  if (weapon.primaryTimer > 0) weapon.primaryTimer = Math.max(0, weapon.primaryTimer - dt);

  // ---- state machine: pick desired primary state ----
  let desired: WeaponPrimary;
  if (weapon.primary === 'drawing' && weapon.primaryTimer > 0) {
    desired = 'drawing';
  } else if (weapon.reloading) {
    desired = 'reloading';
  } else if (firing && weapon.ammo > 0) {
    desired = 'firing';
  } else {
    const moving = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD');
    desired = moving ? 'running' : 'idle';
  }
  if (desired !== weapon.primary) transitionPrimary(weapon, desired);

  // Reload completion: ammo refills when the timer runs out.
  if (weapon.reloading && weapon.primaryTimer <= 0) {
    weapon.reloading = false;
    weapon.ammo = MAG_SIZE;
    updateAmmoHud();
  }

  // Hold-to-fire — attack() guards on cooldown / reload / drawing.
  if (firing && weapon.cooldown <= 0 && !weapon.reloading) attack();
  if (weapon.mixer) weapon.mixer.update(dt);

  // Procedural recoil fallback (only used when no Shoot clip).
  if (weapon.recoil > 0) {
    weapon.recoil = Math.max(0, weapon.recoil - dt * 8);
    const k = weapon.recoil;
    weapon.group.position.z = -0.45 + 0.05 * k;
    weapon.group.rotation.x = -0.18 * k;
  } else if (!weapon.fireAction) {
    weapon.group.position.z = -0.45;
    weapon.group.rotation.x = 0;
  }
}

// --- credits --------------------------------------------------------------

interface CreditsEntry { slug: string; name: string; author: string; license: string; source: string }

async function renderCredits(): Promise<void> {
  try {
    const res = await fetch(`${MODEL_BASE}CREDITS.json`);
    if (!res.ok) return;
    const all: CreditsEntry[] = await res.json();
    const used = all.filter(c => ['asteroid', 'rock', 'fps_rifle', 'monster', 'flier'].includes(c.slug));
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
    tickMonsterSpawner(dt);
    tickMonsters(dt);
    tickProjectiles(dt);
    updateWeapon(dt);
    updateFragments(dt);
    updateDamageFlash(dt);

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

// Loader overlay (shown while assets/shaders compile, hidden once the
// first real frame is ready).
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');
const loaderStep = document.getElementById('loader-step');

async function step(label: string, total: number, idx: number, fn: () => Promise<unknown> | unknown): Promise<void> {
  if (loaderStep) loaderStep.textContent = label;
  if (loaderFill) loaderFill.style.width = `${Math.round((idx / total) * 100)}%`;
  // give the browser a frame to paint the updated loader before the work runs
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  try {
    console.log(`[boot] ${label} ...`);
    await fn();
    console.log(`[boot] ${label} OK`);
  } catch (e) {
    console.error(`[boot] ${label} FAILED:`, e);
  }
}

(async () => {
  const STEPS = 7;
  let i = 0;
  renderCredits();
  await step('loading asteroid',          STEPS, ++i, loadAsteroid);
  await step('sampling surface',          STEPS, ++i, () => buildSurfaceTable());
  player.position.set(0, asteroidBoundingRadius * 1.2, 0);
  await step('scattering rocks',          STEPS, ++i, loadAndScatterRocks);
  await step('loading creatures',         STEPS, ++i, loadMonsterTemplate);
  await step('spawning monsters',         STEPS, ++i, spawnInitialMonsters);
  await step('loading weapon',            STEPS, ++i, loadWeapon);
  // Pre-compile every shader currently in the scene so the first render
  // (and any subsequent monster/projectile spawn) doesn't stall while the
  // GPU builds new programs. Without this, the first time a flier or
  // projectile is drawn the renderer pauses noticeably.
  await step('compiling shaders',         STEPS, ++i, async () => {
    if (typeof renderer.compileAsync === 'function') {
      await renderer.compileAsync(scene, camera);
    } else {
      renderer.compile(scene, camera);
    }
  });

  if (loaderEl) {
    loaderEl.style.opacity = '0';
    setTimeout(() => loaderEl.remove(), 500);
  }
  animate();
})();
