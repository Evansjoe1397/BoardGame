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
const GRASS_COUNT = 18000;

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

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1200);
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
  const planetGeom = new THREE.IcosahedronGeometry(1, 7);
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

// --- grass instancing ------------------------------------------------------

{
  const bladeGeom = new THREE.BufferGeometry();
  bladeGeom.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.05, 0.0, 0.0,
     0.05, 0.0, 0.0,
     0.00, 0.4, 0.0,
  ], 3));
  bladeGeom.setIndex([0, 1, 2]);
  bladeGeom.computeVertexNormals();

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    side: THREE.DoubleSide,
    metalness: 0,
  });
  const grass = new THREE.InstancedMesh(bladeGeom, bladeMat, GRASS_COUNT);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const upY = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colorTmp = new THREE.Color();
  const c1 = new THREE.Color(0x5d8a32);
  const c2 = new THREE.Color(0x86a64a);

  for (let i = 0; i < GRASS_COUNT; i++) {
    dir.randomDirection();
    const r = surfaceRadius(dir);

    const altNorm = (r - PLANET_RADIUS) / TERRAIN_AMPLITUDE;
    if (altNorm > 0.5) {
      m.makeScale(0, 0, 0);
      grass.setMatrixAt(i, m);
      continue;
    }

    pos.copy(dir).multiplyScalar(r - 0.02);
    q.setFromUnitVectors(upY, dir);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(dir, Math.random() * Math.PI * 2);
    q.multiply(yawQ);
    const sH = 0.6 + Math.random() * 1.0;
    const sW = 0.7 + Math.random() * 0.7;
    scl.set(sW, sH, sW);
    m.compose(pos, q, scl);
    grass.setMatrixAt(i, m);

    colorTmp.copy(c1).lerp(c2, Math.random());
    grass.setColorAt(i, colorTmp);
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);
}

// --- shatter system --------------------------------------------------------

interface Shatterable {
  group: THREE.Object3D;
  meshes: THREE.Mesh[];
}

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
}

const shatterables: Shatterable[] = [];
const fragments: Fragment[] = [];

const FRAG_LIFE = 2.6;
const FRAG_FADE = 0.7;
const FRAG_MAX_PER_SHATTER = 600;

function shatter(target: Shatterable, hitPoint: THREE.Vector3): void {
  type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mat: THREE.Material };
  const tris: Tri[] = [];

  for (const mesh of target.meshes) {
    mesh.updateMatrixWorld(true);
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const m = mesh.matrixWorld;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ai = idx ? idx.getX(t * 3)     : t * 3;
      const bi = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ci = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, ai).applyMatrix4(m);
      const b = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(m);
      const c = new THREE.Vector3().fromBufferAttribute(pos, ci).applyMatrix4(m);
      tris.push({ a, b, c, mat: mesh.material as THREE.Material });
    }
  }

  scene.remove(target.group);
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

interface NormalizedProp {
  template: THREE.Group; // wrapper, scaled and centred so base sits at y=0
  source: string;
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

/**
 * Walk a loaded glb scene; for each leaf mesh, find its top-level ancestor
 * directly under the scene root. Return each unique top-level subtree —
 * these are treated as independent "props" so packs of objects are scattered
 * individually instead of as one clump.
 */
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

function normalizeProp(node: THREE.Object3D, targetSize: number): THREE.Group {
  const wrap = new THREE.Group();
  const inst = node.clone(true);
  inst.position.set(0, 0, 0);
  wrap.add(inst);
  wrap.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(wrap);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  inst.position.set(-center.x, -bbox.min.y, -center.z);
  wrap.scale.setScalar(targetSize / maxDim);
  return wrap;
}

async function loadProps(slug: string, targetSize: number): Promise<NormalizedProp[]> {
  const url = `${MODEL_BASE}${slug}.glb`;
  let gltf;
  try { gltf = await loader.loadAsync(url); }
  catch (e) { console.warn(`[load] missing ${slug}:`, e); return []; }

  const tops = collectTopLevelProps(gltf.scene);
  const out: NormalizedProp[] = [];
  for (const top of tops) {
    out.push({ template: normalizeProp(top, targetSize), source: slug });
  }
  console.log(`[load] ${slug}: ${tops.length} prop variant(s)`);
  return out;
}

function placeProp(template: THREE.Group, dir: THREE.Vector3): void {
  const inst = template.clone(true);
  inst.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(mat => mat.clone());
    } else {
      mesh.material = (mesh.material as THREE.Material).clone();
    }
  });

  const r = surfaceRadius(dir);
  inst.position.copy(dir).multiplyScalar(r);
  const upY = new THREE.Vector3(0, 1, 0);
  const qOrient = new THREE.Quaternion().setFromUnitVectors(upY, dir);
  inst.quaternion.copy(qOrient);
  inst.rotateY(Math.random() * Math.PI * 2);

  scene.add(inst);

  const meshes: THREE.Mesh[] = [];
  inst.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
  if (meshes.length > 0) shatterables.push({ group: inst, meshes });
}

async function scatterProps(): Promise<void> {
  const pools = await Promise.all(
    SCATTER.map(plan => loadProps(plan.slug, plan.targetSize).then(p => ({ plan, pool: p })))
  );
  for (const { plan, pool } of pools) {
    if (pool.length === 0) continue;
    for (let i = 0; i < plan.count; i++) {
      const tpl = pool[Math.floor(Math.random() * pool.length)];
      const dir = new THREE.Vector3().randomDirection();
      placeProp(tpl.template, dir);
    }
  }
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

const WEAPONS: WeaponConfig[] = [
  { slug: 'weapon_pistol', display: 'Pistol', type: 'ranged', range: 220, cooldown: 0.25, targetSize: 0.32, position: [0.20, -0.18, -0.32], euler: [0, Math.PI, 0],          procRecoilZ: 0.05, hasMuzzleFlash: true },
  { slug: 'weapon_rifle',  display: 'AKM',    type: 'ranged', range: 260, cooldown: 0.10, targetSize: 0.85, position: [0.18, -0.20, -0.45], euler: [0, Math.PI, 0],          procRecoilZ: 0.07, hasMuzzleFlash: true },
  { slug: 'weapon_sword',  display: 'Sword',  type: 'melee',  range: 4.0, cooldown: 0.45, targetSize: 1.10, position: [0.30, -0.30, -0.40], euler: [0, -0.5, 0.4],            procSwingDeg: 100 },
  { slug: 'weapon_anim',   display: 'Colt',   type: 'ranged', range: 220, cooldown: 0.30, targetSize: 0.30, position: [0.20, -0.18, -0.32], euler: [0, Math.PI, 0],          attackKeywords: ['fire', 'shoot', 'recoil'], hasMuzzleFlash: true },
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
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}${cfg.slug}.glb`); }
  catch (e) { console.warn(`[weapon] missing ${cfg.slug}:`, e); return null; }

  const wrap = new THREE.Group();
  const inner = gltf.scene;

  const tmpWrap = new THREE.Group();
  tmpWrap.add(inner);
  tmpWrap.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(tmpWrap);
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
    console.log(`[weapon] ${cfg.slug} clips: ${gltf.animations.map(c => c.name).join(', ')} → attack="${attackClip?.name}"`);
  }

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
    const allMeshes: THREE.Mesh[] = [];
    for (const s of shatterables) allMeshes.push(...s.meshes);
    const hits = raycaster.intersectObjects(allMeshes, false);
    if (hits.length > 0) {
      const target = shatterables.find(s => s.meshes.includes(hits[0].object as THREE.Mesh));
      if (target) shatter(target, hits[0].point);
    }
  } else {
    let best: Shatterable | null = null;
    let bestDist = Infinity;
    const bestPoint = new THREE.Vector3();
    const tmpC = new THREE.Vector3();
    const tmpD = new THREE.Vector3();
    for (const s of shatterables) {
      new THREE.Box3().setFromObject(s.group).getCenter(tmpC);
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
