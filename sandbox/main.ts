/**
 * Asteroid FPS sandbox.
 *
 * - Procedural planet with multi-octave noise terrain (vertex-coloured).
 * - Instanced grass scattered across the surface.
 * - Spherical gravity & FPS controls (WASD + mouse + Space + Shift).
 * - Multiple weapon viewmodels (1/2/3/4 to switch, Q/E cycle). Animations
 *   via AnimationMixer when the .glb has clips, otherwise procedural
 *   recoil/swing.
 * - LMB attack: ranged → raycast, melee → forward-cone overlap.
 * - Hit objects shatter into individual triangles affected by gravity.
 *
 * .glb assets are downloaded by sandbox/scripts/fetch-models.ts into
 * /sandbox/models/. Self-contained: does NOT import from src/.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// --- constants -------------------------------------------------------------

const PLANET_RADIUS = 80;
const TERRAIN_AMPLITUDE = 7;
const GRAVITY = 18;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 7;
const SPRINT_SPEED = 12;
const JUMP_SPEED = 9;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
// Embed props slightly into the surface so they don't float over the
// linearly-interpolated icosahedron faces. The exact noise (surfaceRadius)
// is what placement uses, but the rendered triangles between vertices sag
// below it; without an offset, small objects appear to hover.
const PROP_EMBED = 0.4;

const MODEL_BASE = '/sandbox/models/';

// --- DOM -------------------------------------------------------------------

const appEl = document.getElementById('app')!;
const overlayEl = document.getElementById('overlay')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const creditsEl = document.getElementById('credits')!;
const infoEl = document.getElementById('info')!;

// --- renderer / scene ------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b18);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// near 0.15 / far 600 keeps 24-bit depth precision well-distributed without
// the cost of logarithmicDepthBuffer (which made rendering noticeably slower).
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.15, 600);
scene.add(camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- starfield -------------------------------------------------------------

{
  const starGeom = new THREE.BufferGeometry();
  const N = 2200;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize().multiplyScalar(700 + Math.random() * 100);
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  starGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(
    starGeom,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false }),
  ));
}

// --- lighting --------------------------------------------------------------

scene.add(new THREE.AmbientLight(0x6a7a8c, 0.45));
scene.add(new THREE.HemisphereLight(0x88aaff, 0x303020, 0.35));

const sun = new THREE.DirectionalLight(0xfff1c8, 1.5);
sun.position.set(120, 160, 90);
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
fillLight.position.set(-80, 50, -60);
scene.add(fillLight);

// camera-attached headlight so the weapon viewmodel is always lit
const headlight = new THREE.PointLight(0xffe5b8, 0.7, 5, 1.4);
headlight.position.set(0, 0.05, -0.05);
camera.add(headlight);

// --- terrain ---------------------------------------------------------------

const noise = new SimplexNoise();

function surfaceRadius(unitDir: THREE.Vector3): number {
  let h = 0, amp = 1, freq = 0.7;
  const x = unitDir.x, y = unitDir.y, z = unitDir.z;
  for (let o = 0; o < 4; o++) {
    h += noise.noise3d(x * freq, y * freq, z * freq) * amp;
    amp *= 0.5; freq *= 2.1;
  }
  return PLANET_RADIUS + h * TERRAIN_AMPLITUDE * 0.5;
}

{
  const planetGeom = new THREE.IcosahedronGeometry(1, 6);
  const pos = planetGeom.attributes.position;
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  const colGrass  = new THREE.Color(0x4f7a2c);
  const colDark   = new THREE.Color(0x2f5018);
  const colDirt   = new THREE.Color(0x705536);
  const colStone  = new THREE.Color(0x5e5d63);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); // unit
    const r = surfaceRadius(v);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);

    const altitude = (r - PLANET_RADIUS) / TERRAIN_AMPLITUDE; // ~[-1, 1]
    const c = new THREE.Color();
    if (altitude < -0.2)      c.copy(colGrass).lerp(colDark, 0.4);
    else if (altitude < 0.25) c.copy(colGrass);
    else if (altitude < 0.7)  c.copy(colGrass).lerp(colDirt, (altitude - 0.25) / 0.45);
    else                      c.copy(colDirt).lerp(colStone, Math.min(1, (altitude - 0.7) / 0.4));

    const tint = (noise.noise3d(v.x * 5, v.y * 5, v.z * 5) + 1) * 0.5;
    const k = 0.85 + tint * 0.3;
    c.r *= k; c.g *= k; c.b *= k;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  planetGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  planetGeom.computeVertexNormals();

  const planet = new THREE.Mesh(
    planetGeom,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  );
  scene.add(planet);
}

// (grass removed — visuals weren't selling it; planet vertex colors carry the surface)

// --- shatter system --------------------------------------------------------

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Shatterable {
  // Logical reference to a single placed prop.
  // Backing storage is a set of InstancedMesh slots (one per sub-mesh of the prop template).
  template: PropTemplate;
  slot: number;
  // World matrix of each sub-mesh at placement time, used to extract world-space
  // triangle positions when shattering.
  subWorlds: THREE.Matrix4[];
  alive: boolean;
}

const shatterables: Shatterable[] = [];
const fragments: Fragment[] = [];

const FRAG_LIFE = 2.6;
const FRAG_FADE = 0.7;
const FRAG_MAX_PER_SHATTER = 600;

function shatter(target: Shatterable, hitPoint: THREE.Vector3): void {
  if (!target.alive) return;
  type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mat: THREE.Material };
  const tris: Tri[] = [];
  const tpl = target.template;

  for (let i = 0; i < tpl.subs.length; i++) {
    const sub = tpl.subs[i];
    const m = target.subWorlds[i];
    const geom = sub.geometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ai = idx ? idx.getX(t * 3)     : t * 3;
      const bi = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ci = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, ai).applyMatrix4(m);
      const b = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(m);
      const c = new THREE.Vector3().fromBufferAttribute(pos, ci).applyMatrix4(m);
      tris.push({ a, b, c, mat: sub.material });
    }
  }

  // hide this slot in every InstancedMesh of the template
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const ins of tpl.instancedMeshes) {
    ins.setMatrixAt(target.slot, zero);
    ins.instanceMatrix.needsUpdate = true;
  }
  target.alive = false;
  const idx = shatterables.indexOf(target);
  if (idx >= 0) shatterables.splice(idx, 1);

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

    const srcMat = mat as THREE.MeshStandardMaterial;
    const fragMat = new THREE.MeshStandardMaterial({
      color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0x888888),
      roughness: srcMat.roughness ?? 0.7,
      metalness: srcMat.metalness ?? 0.1,
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
    const speed = 5 + Math.random() * 6 + Math.max(0, 4 - dist) * 1.5;
    const velocity = outward.multiplyScalar(speed);
    velocity.x += (Math.random() - 0.5) * 2.5;
    velocity.y += (Math.random() - 0.5) * 2.5;
    velocity.z += (Math.random() - 0.5) * 2.5;

    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    );

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

    const r = f.mesh.position.length();
    const surf = surfaceRadius(radial);
    if (r < surf + 0.05) {
      const n = radial;
      const vDotN = f.velocity.dot(n);
      if (vDotN < 0) {
        f.velocity.addScaledVector(n, -1.6 * vDotN);
        f.velocity.multiplyScalar(0.4);
        f.angVel.multiplyScalar(0.6);
      }
      f.mesh.position.copy(n.clone().multiplyScalar(surf + 0.05));
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

// --- glb loading & scattered prop placement -------------------------------

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * Bounding box from mesh geometry only (skips bones/empties/lights). Required
 * for skinned models where Object3D ancestors can otherwise inflate the bbox.
 */
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

interface PropSubMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /**
   * Mesh transform relative to the prop root, with normalisation baked in
   * (uniform scale to targetSize + recenter so base sits at y=0). Multiplying
   * this by a placement matrix yields the world matrix for the sub-mesh.
   */
  localMatrix: THREE.Matrix4;
}

interface PropTemplate {
  templateId: string;       // e.g. "tree_0"
  slug: string;
  subs: PropSubMesh[];
  capacity: number;
  instancedMeshes: THREE.InstancedMesh[]; // one per sub-mesh
  nextSlot: number;
}

interface ScatterPlan { slug: string; count: number; targetSize: number }

const SCATTER: ScatterPlan[] = [
  { slug: 'tree',     count: 60, targetSize: 6.0 },
  { slug: 'rock',     count: 70, targetSize: 1.6 },
  { slug: 'mushroom', count: 65, targetSize: 1.0 },
  { slug: 'crate',    count: 24, targetSize: 1.1 },
  { slug: 'barrel',   count: 70, targetSize: 1.4 },
  { slug: 'fox',      count: 8,  targetSize: 1.0 },
];

const propTemplates: PropTemplate[] = [];
// Reverse lookup: from an InstancedMesh hit, find the owning template + sub-index.
const meshToTemplate: Map<THREE.InstancedMesh, { template: PropTemplate; subIdx: number }> = new Map();

function collectTopLevelProps(root: THREE.Object3D): THREE.Object3D[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
  if (meshes.length === 0) return [];
  const tops = new Set<THREE.Object3D>();
  for (const m of meshes) {
    let p: THREE.Object3D = m;
    while (p.parent && p.parent !== root) p = p.parent;
    tops.add(p);
  }
  return Array.from(tops);
}

/**
 * Build a PropTemplate from a top-level subtree of a loaded glb. Each child
 * mesh becomes a PropSubMesh sharing geometry+material. An InstancedMesh
 * (capacity = capacity) is created per sub-mesh and added to the scene.
 *
 * Memory savings: rather than cloning the prop N times (N copies of geometry,
 * materials, mesh structs, draw calls), each sub-mesh draws all instances in
 * a single call from one shared GPU buffer.
 */
function buildTemplate(slug: string, top: THREE.Object3D, targetSize: number, capacity: number, variantIdx: number): PropTemplate | null {
  // Detach into a clean temporary parent at origin so matrixWorld is in a
  // predictable local frame.
  const tmpRoot = new THREE.Group();
  tmpRoot.add(top);
  tmpRoot.updateMatrixWorld(true);

  const bbox = meshOnlyBbox(tmpRoot);
  if (bbox.isEmpty()) return null;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxDim;

  // Normalisation: shift so xz centred & base at y=0, then scale uniformly.
  // M_norm = S * T(-center.x, -bbox.min.y, -center.z)
  const normMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
  normMatrix.multiply(new THREE.Matrix4().makeTranslation(-center.x, -bbox.min.y, -center.z));

  const subs: PropSubMesh[] = [];
  top.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const meshLocal = new THREE.Matrix4().copy(mesh.matrixWorld); // in tmpRoot frame
    const finalLocal = new THREE.Matrix4().multiplyMatrices(normMatrix, meshLocal);
    subs.push({
      geometry: mesh.geometry,
      material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material as THREE.Material,
      localMatrix: finalLocal,
    });
  });

  if (subs.length === 0) return null;

  const tpl: PropTemplate = {
    templateId: `${slug}_${variantIdx}`,
    slug,
    subs,
    capacity,
    instancedMeshes: [],
    nextSlot: 0,
  };

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    const ins = new THREE.InstancedMesh(sub.geometry, sub.material, capacity);
    ins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ins.frustumCulled = false; // instances span the whole planet
    for (let s = 0; s < capacity; s++) ins.setMatrixAt(s, zero);
    scene.add(ins);
    tpl.instancedMeshes.push(ins);
    meshToTemplate.set(ins, { template: tpl, subIdx: i });
  }
  return tpl;
}

async function loadAndRegisterTemplates(slug: string, targetSize: number, totalCount: number): Promise<void> {
  const url = `${MODEL_BASE}${slug}.glb`;
  let gltf;
  try { gltf = await loader.loadAsync(url); }
  catch (e) { console.warn(`[load] missing ${slug}:`, e); return; }

  const tops = collectTopLevelProps(gltf.scene);
  if (tops.length === 0) return;
  const perVariant = Math.ceil(totalCount / tops.length);

  let registered = 0;
  for (let i = 0; i < tops.length; i++) {
    const tpl = buildTemplate(slug, tops[i], targetSize, perVariant, i);
    if (tpl) { propTemplates.push(tpl); registered++; }
  }
  console.log(`[load] ${slug}: ${registered}/${tops.length} variant(s) registered, capacity=${perVariant} each`);
}

function placeProp(slug: string, dir: THREE.Vector3): void {
  // pick a template variant for this slug that still has room
  const candidates = propTemplates.filter(t => t.slug === slug && t.nextSlot < t.capacity);
  if (candidates.length === 0) return;
  const tpl = candidates[Math.floor(Math.random() * candidates.length)];
  const slot = tpl.nextSlot++;

  const r = surfaceRadius(dir);
  const pos = dir.clone().multiplyScalar(r);
  const upY = new THREE.Vector3(0, 1, 0);
  const orient = new THREE.Quaternion().setFromUnitVectors(upY, dir);
  const yawQ = new THREE.Quaternion().setFromAxisAngle(dir, Math.random() * Math.PI * 2);
  orient.multiply(yawQ);
  // placement = T(pos) * R(orient); scale stays in localMatrix
  const placement = new THREE.Matrix4().compose(pos, orient, new THREE.Vector3(1, 1, 1));

  const subWorlds: THREE.Matrix4[] = [];
  for (let i = 0; i < tpl.subs.length; i++) {
    const sub = tpl.subs[i];
    const world = new THREE.Matrix4().multiplyMatrices(placement, sub.localMatrix);
    tpl.instancedMeshes[i].setMatrixAt(slot, world);
    tpl.instancedMeshes[i].instanceMatrix.needsUpdate = true;
    subWorlds.push(world);
  }
  shatterables.push({ template: tpl, slot, subWorlds, alive: true });
}

async function scatterProps(): Promise<void> {
  await Promise.all(
    SCATTER.map(plan => loadAndRegisterTemplates(plan.slug, plan.targetSize, plan.count))
  );
  for (const plan of SCATTER) {
    for (let i = 0; i < plan.count; i++) {
      const dir = new THREE.Vector3().randomDirection();
      placeProp(plan.slug, dir);
    }
  }
}

function getAllPropInstancedMeshes(): THREE.InstancedMesh[] {
  return [...meshToTemplate.keys()];
}

// --- weapons ---------------------------------------------------------------

interface WeaponConfig {
  slug: string;
  display: string;
  type: 'ranged' | 'melee';
  range: number;
  cooldown: number;
  targetSize: number;
  position: [number, number, number];
  euler?: [number, number, number];
  attackKeywords?: string[];
  procRecoilZ?: number;
  procSwingDeg?: number;
  hasMuzzleFlash?: boolean;
}

// Per-weapon: targetSize is the longest-axis world size of the actual visible
// geometry (bones/empties excluded). euler is applied to wrap to align the
// model's natural forward axis with camera -Z. Tuned by inspection of
// each .glb in this scene; revisit when swapping models.
const WEAPONS: WeaponConfig[] = [
  // DJMaesen pistol: model's natural forward = +Z, euler [0, π, 0] flips it to -Z
  { slug: 'weapon_pistol', display: 'Pistol', type: 'ranged', range: 220, cooldown: 0.25, targetSize: 0.28, position: [0.20, -0.18, -0.32], euler: [0, Math.PI, 0],         procRecoilZ: 0.05, hasMuzzleFlash: true },
  // TastyTony AKM: natural forward = +X, rotate around Y by π/2 so barrel ends up along -Z
  { slug: 'weapon_rifle',  display: 'AKM',    type: 'ranged', range: 260, cooldown: 0.10, targetSize: 0.70, position: [0.16, -0.22, -0.42], euler: [0, Math.PI / 2, 0],     procRecoilZ: 0.07, hasMuzzleFlash: true },
  // Ramhat cyberpunk blade: natural blade direction = +Y. Rotate so blade points -Z+slightly up; hilt down-near.
  { slug: 'weapon_sword',  display: 'Sword',  type: 'melee',  range: 3.5, cooldown: 0.45, targetSize: 0.85, position: [0.28, -0.30, -0.20], euler: [-Math.PI / 2 + 0.3, 0.3, 0.4], procSwingDeg: 110 },
  // Ole Gunnar Isager Colt M1911 (animated): natural forward = +X. Same as AKM.
  { slug: 'weapon_anim',   display: 'Colt',   type: 'ranged', range: 220, cooldown: 0.30, targetSize: 0.22, position: [0.20, -0.18, -0.30], euler: [0, Math.PI / 2, 0],     attackKeywords: ['fire', 'shoot', 'recoil'], hasMuzzleFlash: true },
];

interface ActiveWeapon {
  config: WeaponConfig;
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  attackClip: THREE.AnimationClip | null;
  cooldown: number;
  procRecoil: number;
  procSwing: number;
}

const weaponPool: ActiveWeapon[] = [];
let activeIndex = 0;

async function loadWeapon(cfg: WeaponConfig): Promise<ActiveWeapon | null> {
  const url = `${MODEL_BASE}${cfg.slug}.glb`;
  let gltf;
  try { gltf = await loader.loadAsync(url); }
  catch (e) { console.warn(`[weapon] FAIL ${cfg.slug} from ${url}:`, e); return null; }

  const wrap = new THREE.Group();
  const inner = gltf.scene;

  // park inner under a temporary parent at origin so meshOnlyBbox is in
  // a clean local frame, then recompute with inner properly mounted.
  const tmpWrap = new THREE.Group();
  tmpWrap.add(inner);
  tmpWrap.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpWrap);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = cfg.targetSize / maxDim;
  inner.position.set(-center.x, -center.y, -center.z);

  wrap.add(inner);
  wrap.scale.setScalar(s);
  wrap.position.set(cfg.position[0], cfg.position[1], cfg.position[2]);
  if (cfg.euler) wrap.rotation.set(cfg.euler[0], cfg.euler[1], cfg.euler[2]);
  wrap.visible = false;
  camera.add(wrap);

  const mixer = gltf.animations.length > 0 ? new THREE.AnimationMixer(inner) : null;
  let attackClip: THREE.AnimationClip | null = null;
  if (gltf.animations.length > 0) {
    const keys = cfg.attackKeywords ?? ['fire', 'shoot', 'attack', 'swing', 'slash'];
    for (const clip of gltf.animations) {
      const n = clip.name.toLowerCase();
      if (!attackClip && keys.some(k => n.includes(k))) attackClip = clip;
    }
    if (!attackClip) attackClip = gltf.animations[0];
  }

  let meshCount = 0;
  inner.traverse(c => { if ((c as THREE.Mesh).isMesh) meshCount++; });

  console.log(`[weapon] ok ${cfg.slug}: meshes=${meshCount}, bbox=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}, scale=${s.toFixed(3)}, clips=[${gltf.animations.map(c => c.name).join(', ')}]${attackClip ? ` → attack="${attackClip.name}"` : ''}`);

  return { config: cfg, group: wrap, mixer, attackClip, cooldown: 0, procRecoil: 0, procSwing: 0 };
}

function setActiveWeapon(idx: number): void {
  if (idx < 0 || idx >= weaponPool.length) return;
  for (const w of weaponPool) w.group.visible = false;
  activeIndex = idx;
  weaponPool[idx].group.visible = true;
  weaponHudEl.innerHTML = weaponPool.map((w, i) =>
    `${i === idx ? '<b>' : ''}${i + 1}: ${w.config.display}${i === idx ? '</b>' : ''}`
  ).join('  ·  ');
}

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
flashSprite.scale.set(0.6, 0.6, 0.6);
flashSprite.position.set(0, -0.05, -0.6);
flashSprite.visible = false;
camera.add(flashSprite);

let flashTime = 0;

function spawnMuzzleFlash(): void {
  flashSprite.visible = true;
  flashTime = 0.06;
  flashSprite.scale.setScalar(0.4 + Math.random() * 0.3);
  flashSprite.material.rotation = Math.random() * Math.PI;
}

const raycaster = new THREE.Raycaster();

function attack(): void {
  if (weaponPool.length === 0) return;
  const w = weaponPool[activeIndex];
  if (w.cooldown > 0) return;
  w.cooldown = w.config.cooldown;

  if (w.mixer && w.attackClip) {
    const a = w.mixer.clipAction(w.attackClip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.reset().play();
  } else if (w.config.type === 'ranged') {
    w.procRecoil = 1;
  } else {
    w.procSwing = 1;
  }

  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  if (w.config.type === 'ranged') {
    if (w.config.hasMuzzleFlash) spawnMuzzleFlash();
    raycaster.set(origin, dir);
    raycaster.far = w.config.range;
    const hits = raycaster.intersectObjects(getAllPropInstancedMeshes(), false);
    if (hits.length > 0) {
      const hit = hits[0];
      const info = meshToTemplate.get(hit.object as THREE.InstancedMesh);
      const slot = hit.instanceId;
      if (info && slot != null) {
        const target = shatterables.find(s => s.template === info.template && s.slot === slot && s.alive);
        if (target) shatter(target, hit.point);
      }
    }
  } else {
    // Melee: scan alive instances; find the closest one whose centre is in
    // a forward 60° cone within range.
    let best: Shatterable | null = null;
    let bestDist = Infinity;
    const bestPoint = new THREE.Vector3();
    const tmpC = new THREE.Vector3();
    const tmpD = new THREE.Vector3();
    const subBbox = new THREE.Box3();
    for (const s of shatterables) {
      if (!s.alive) continue;
      // approximate centre = average of subWorlds positions
      tmpC.set(0, 0, 0);
      for (const m of s.subWorlds) {
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        tmpC.add(p);
      }
      tmpC.divideScalar(s.subWorlds.length);
      tmpD.copy(tmpC).sub(origin);
      const dist = tmpD.length();
      if (dist > w.config.range) continue;
      tmpD.divideScalar(dist);
      if (tmpD.dot(dir) < 0.5) continue;
      if (dist < bestDist) {
        bestDist = dist; best = s; bestPoint.copy(tmpC);
      }
    }
    if (best) shatter(best, bestPoint);
    void subBbox;
  }
}

// --- player ----------------------------------------------------------------

interface Player {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  bobPhase: number;
}

const player: Player = {
  position: new THREE.Vector3(0, PLANET_RADIUS + 5, 0),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  bobPhase: 0,
};

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Digit1') setActiveWeapon(0);
  if (e.code === 'Digit2') setActiveWeapon(1);
  if (e.code === 'Digit3') setActiveWeapon(2);
  if (e.code === 'Digit4') setActiveWeapon(3);
  if (e.code === 'KeyQ' || e.code === 'KeyE') {
    if (weaponPool.length > 0) {
      const dir = e.code === 'KeyE' ? 1 : -1;
      setActiveWeapon((activeIndex + dir + weaponPool.length) % weaponPool.length);
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  } else {
    attack();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlayEl.style.display = locked ? 'none' : 'grid';
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
  const up = player.position.clone().normalize();

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

  const targetTang = wishDir.multiplyScalar(moving ? speed : 0);
  vTang.lerp(targetTang, 1 - Math.exp(-12 * dt));

  let vUpNew = vUp - GRAVITY * dt;
  if (keys.has('Space') && player.grounded) {
    vUpNew = JUMP_SPEED;
    player.grounded = false;
  }

  player.velocity.copy(vTang).addScaledVector(up, vUpNew);
  player.position.addScaledVector(player.velocity, dt);

  const dirNow = player.position.clone().normalize();
  const surfR = surfaceRadius(dirNow);
  const footR = surfR + PLAYER_RADIUS;
  if (player.position.length() < footR) {
    player.position.copy(dirNow.clone().multiplyScalar(footR));
    const newUp = dirNow;
    const inward = player.velocity.dot(newUp);
    if (inward < 0) player.velocity.addScaledVector(newUp, -inward);
    player.grounded = true;
  } else if (player.position.length() > footR + 0.05) {
    player.grounded = false;
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

function updateWeapons(dt: number): void {
  for (const w of weaponPool) {
    if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.mixer) w.mixer.update(dt);

    if (!w.mixer || !w.attackClip) {
      const baseZ = w.config.position[2];
      const baseRotZ = w.config.euler ? w.config.euler[2] : 0;
      const baseRotX = w.config.euler ? w.config.euler[0] : 0;

      if (w.config.type === 'ranged' && w.procRecoil > 0) {
        w.procRecoil = Math.max(0, w.procRecoil - dt * 6);
        const k = w.procRecoil;
        w.group.position.z = baseZ + (w.config.procRecoilZ ?? 0.04) * k;
        w.group.rotation.x = baseRotX - 0.25 * k;
      } else if (w.config.type === 'melee' && w.procSwing > 0) {
        w.procSwing = Math.max(0, w.procSwing - dt * 3);
        const k = 1 - w.procSwing;
        const swing = (w.config.procSwingDeg ?? 80) * Math.PI / 180;
        w.group.rotation.z = baseRotZ - Math.sin(k * Math.PI) * swing;
      } else {
        w.group.position.z = baseZ;
        if (w.config.euler) {
          w.group.rotation.set(w.config.euler[0], w.config.euler[1], w.config.euler[2]);
        } else {
          w.group.rotation.set(0, 0, 0);
        }
      }
    }
  }
}

// --- HUD: weapon indicator -------------------------------------------------

const weaponHudEl = document.createElement('div');
weaponHudEl.style.position = 'fixed';
weaponHudEl.style.left = '50%';
weaponHudEl.style.bottom = '14px';
weaponHudEl.style.transform = 'translateX(-50%)';
weaponHudEl.style.font = '12px/1.4 system-ui, sans-serif';
weaponHudEl.style.color = '#cfd8e3';
weaponHudEl.style.background = 'rgba(0,0,0,0.45)';
weaponHudEl.style.padding = '6px 10px';
weaponHudEl.style.borderRadius = '4px';
weaponHudEl.style.pointerEvents = 'none';
document.body.appendChild(weaponHudEl);

// --- credits ---------------------------------------------------------------

interface CreditsEntry { slug: string; name: string; author: string; license: string; source: string }

async function loadCredits(): Promise<CreditsEntry[]> {
  try {
    const res = await fetch(`${MODEL_BASE}CREDITS.json`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}

function renderCredits(credits: CreditsEntry[]): void {
  if (!credits.length) return;
  const lines = credits.map(c =>
    `<b>${escapeHtml(c.name)}</b> · ${escapeHtml(c.author)} · ${escapeHtml(c.license)} · <a href="${escapeHtml(c.source)}" target="_blank" rel="noopener">link</a>`
  );
  creditsEl.innerHTML = `Sketchfab models:<br/>${lines.join('<br/>')}`;
}

// --- main loop -------------------------------------------------------------

const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  tickPlayer(dt);
  updateWeapons(dt);
  updateFragments(dt);

  if (flashTime > 0) {
    flashTime -= dt;
    if (flashTime <= 0) flashSprite.visible = false;
  }

  infoEl.textContent = `targets: ${shatterables.length}  ·  fragments: ${fragments.length}  ·  alt: ${(player.position.length() - PLANET_RADIUS).toFixed(2)}`;

  renderer.render(scene, camera);
}

// --- bootstrap -------------------------------------------------------------

(async () => {
  const credits = await loadCredits();
  renderCredits(credits);

  await scatterProps();

  for (const cfg of WEAPONS) {
    const w = await loadWeapon(cfg);
    if (w) weaponPool.push(w);
  }
  if (weaponPool.length > 0) setActiveWeapon(0);

  animate();
})();
