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
const MONSTER_INITIAL = 12;
const FLIER_INITIAL   = 2;
const MAX_ALIVE_WALKERS = 12; // hard cap on walkers alive at once
const MAX_ALIVE_FLIERS  = 6;  // hard cap on fliers alive at once
const MONSTER_MAX_ALIVE = MAX_ALIVE_WALKERS + MAX_ALIVE_FLIERS;
const MONSTER_SPAWN_INTERVAL = 2.0;     // seconds between trickle spawns

// Asteroid 1 quota — total spawn budget across the run.
const TARGET_WALKERS = 50;
const TARGET_FLIERS  = 15;

// XP rewards per kind.
const XP_PER_WALKER = 10;
const XP_PER_FLIER  = 15;
const XP_PER_HEADSHOT = 15; // overrides per-kind reward when the kill was a headshot

// Level-up thresholds (cumulative XP required to enter each level).
//   1: start  2: 50  3: 120  4: 250  5: 500  6: 1000  7: 2000  8: 4000  9: 8000
const LEVEL_THRESHOLDS = [0, 50, 120, 250, 500, 1000, 2000, 4000, 8000];

// Player health.
const PLAYER_MAX_HP = 20;
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
const FLIER_MAX_HP = 1;  // one-shot kill

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

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1500);
scene.add(camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- starfield ------------------------------------------------------------

const starsField: THREE.Points = (() => {
  const N = 1800;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize().multiplyScalar(700);
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }));
  scene.add(points);
  return points;
})();

// --- skydome (optional) ---------------------------------------------------
//
// 360° HDRI panorama. Off by default — press `B` in-game to toggle.
//
// Implementation: extract the equirectangular texture from the glb and set
// it as `scene.background`. Three.js then projects it as an infinite sphere
// — no near/far-plane clipping, no UV seams, no z-fighting with foreground
// geometry. (A meshed skydome was tried first; on the second asteroid the
// camera sat far enough off-centre that the dome's far wall poked past
// camera.far=800 and clipped into a black "hole" in the direction of view.)
let skydomeTexture: THREE.Texture | null = null;
let skydomeOn = false;
const DEFAULT_BG = new THREE.Color(0x05080f);

async function loadSkydome(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}skydome.glb`); }
  catch {
    console.log('[skydome] not present — run sandbox/scripts/fetch-models.ts to download');
    return;
  }
  // Different glb authors stash a panorama on different texture slots — this
  // particular asset ships baseColor=(0,0,0) with the actual nebula on the
  // emissiveMap. Check the usual slots in priority order.
  const SLOTS = ['map', 'emissiveMap', 'lightMap', 'aoMap', 'normalMap'] as const;
  let panorama: THREE.Texture | null = null;
  let foundSlot = '';
  gltf.scene.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const slot of SLOTS) {
        const tex = (mat as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
        if (tex && !panorama) { panorama = tex; foundSlot = slot; break; }
      }
    }
  });
  if (!panorama) {
    console.warn('[skydome] no texture found in glb (checked map/emissiveMap/lightMap/aoMap/normalMap)');
    return;
  }
  // Equirectangular projection — Three.js maps this onto an infinite sphere
  // when used as scene.background. No mesh, no clipping.
  (panorama as THREE.Texture).mapping = THREE.EquirectangularReflectionMapping;
  (panorama as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
  skydomeTexture = panorama;
  console.log(`[skydome] panorama loaded (slot="${foundSlot}")`);
  // Default to the panorama sky — `B` toggles back to the procedural starfield.
  setSkyMode(true);
}

function setSkyMode(useDome: boolean): void {
  skydomeOn = useDome && !!skydomeTexture;
  scene.background = skydomeOn ? skydomeTexture! : DEFAULT_BG;
  starsField.visible = !skydomeOn;
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyB') return;
  if (!skydomeTexture) {
    console.log('[skydome] not loaded — fetch the model first');
    return;
  }
  setSkyMode(!skydomeOn);
});

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

  // Distant decorative asteroid — same mesh, darker materials, slow rotation,
  // unreachable for now. Sits in the player's sky as a future "next level".
  spawnDecorAsteroid();
  placeJumpField();
  placeMirrorField();
}

let decorAsteroid: THREE.Object3D | null = null;

function spawnDecorAsteroid(): void {
  if (!asteroidMesh) return;
  const decor = asteroidMesh.clone(true);
  // Clone materials (darker) so we don't tint the playable asteroid too.
  decor.traverse(c => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const cloned = mats.map(mat => {
      const sm = (mat as THREE.MeshStandardMaterial).clone();
      if (sm.color) sm.color.multiplyScalar(0.4); // darker rock
      sm.roughness = Math.min(1, (sm.roughness ?? 0.9) * 1.05);
      return sm;
    });
    m.material = Array.isArray(m.material) ? cloned : cloned[0];
  });
  // Place far away, somewhere in the upper sky.
  const dir = new THREE.Vector3(0.55, 0.45, -0.7).normalize();
  decor.position.copy(dir).multiplyScalar(asteroidBoundingRadius * 6);
  // Slightly smaller in apparent silhouette.
  decor.scale.multiplyScalar(0.9);
  scene.add(decor);
  // Force-bake position+scale into matrixWorld of every descendant. Without
  // this, raycasts against `decor` run against the mesh in its pre-transform
  // pose (origin, scale 1) — same gotcha as the main asteroid above. Missed
  // raycasts are why the forward jump used to land in empty space.
  decor.updateMatrixWorld(true);
  decorAsteroid = decor;
}

function tickDecorAsteroid(_dt: number): void {
  // Both jumpable asteroids stay stationary — their teleport rings are
  // pinned in world space, and any spin would slide them off the surface.
}

// --- third (decorative) asteroid -----------------------------------------
//
// Toutatis sitting in the player's sky on the opposite side from the second
// (jumpable) asteroid. Pure decoration — no physics, no jump field, slowly
// rotates so it doesn't feel painted-on.
let farAsteroid: THREE.Object3D | null = null;

async function loadFarAsteroid(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}asteroid_far.glb`); }
  catch { console.warn('[asteroid_far] not found'); return; }

  const root = gltf.scene;
  const tmpRoot = new THREE.Group();
  tmpRoot.add(root);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  if (bbox.isEmpty()) return;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // Roughly half the playable asteroid's diameter.
  const targetDiameter = TARGET_PLANET_DIAMETER * 0.55 * 1.25;
  const scale = targetDiameter / maxDim;

  // Slightly tint darker so it reads as "distant".
  root.traverse(c => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const cloned = mats.map(mat => {
      const sm = (mat as THREE.MeshStandardMaterial).clone();
      if (sm.color) sm.color.multiplyScalar(0.55);
      return sm;
    });
    m.material = Array.isArray(m.material) ? cloned : cloned[0];
  });

  // Centre the mesh on its bbox so rotation looks natural.
  root.position.set(-center.x, -center.y, -center.z);

  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar(scale);
  // Place near the second asteroid so the player can TAB-jump between them
  // without crossing the whole sky. Decor #2 sits at decorDir2 * 6R; offset
  // by a sideways tangent of ~3R so they're visibly distinct yet close.
  const decorDir2 = new THREE.Vector3(0.55, 0.45, -0.7).normalize();
  const sideways  = new THREE.Vector3(0.7, -0.3, 0.65).normalize();
  const farPos = decorDir2.clone().multiplyScalar(asteroidBoundingRadius * 6)
                          .addScaledVector(sideways, asteroidBoundingRadius * 3);
  wrap.position.copy(farPos);
  wrap.rotation.y = Math.random() * Math.PI * 2;
  scene.add(wrap);
  wrap.updateMatrixWorld(true);
  farAsteroid = wrap;
  console.log(`[asteroid_far] placed at ${wrap.position.toArray().map(n => n.toFixed(0)).join(',')}, scale=${scale.toFixed(3)}`);
  // Now that the mesh's matrixWorld is current, place the teleport ring on
  // its near face (facing decor #2).
  placeThirdField();
}

// --- arc jump to the second asteroid --------------------------------------

const JUMP_DURATION = 2.6;       // seconds along the arc
const JUMP_ARC_HEIGHT = 60;      // metres above the line midpoint

let isJumping = false;
let jumpT = 0;
const jumpStart = new THREE.Vector3();
const jumpEnd = new THREE.Vector3();
const jumpMid = new THREE.Vector3();
const jumpUp = new THREE.Vector3();

// "Press TAB to jump" — appears when the crosshair is on a portal ring.
const jumpHintEl = document.createElement('div');
jumpHintEl.style.position = 'fixed';
jumpHintEl.style.top = '60%';
jumpHintEl.style.left = '50%';
jumpHintEl.style.transform = 'translate(-50%, -50%)';
jumpHintEl.style.font = '600 20px ui-sans-serif, system-ui, sans-serif';
jumpHintEl.style.color = '#ffd66e';
jumpHintEl.style.textShadow = '0 2px 6px rgba(0,0,0,0.7)';
jumpHintEl.style.opacity = '0';
jumpHintEl.style.transition = 'opacity 0.25s';
jumpHintEl.style.pointerEvents = 'none';
jumpHintEl.style.zIndex = '6';
jumpHintEl.textContent = 'Press TAB to jump';
document.body.appendChild(jumpHintEl);

// "Spot the portal..." — long-form hint, shown while the player is standing
// inside their current asteroid's own ring (where they'd otherwise wonder
// what to do next).
const portalHintEl = document.createElement('div');
portalHintEl.style.position = 'fixed';
portalHintEl.style.top = '64%';
portalHintEl.style.left = '50%';
portalHintEl.style.transform = 'translate(-50%, -50%)';
portalHintEl.style.font = '500 16px ui-sans-serif, system-ui, sans-serif';
portalHintEl.style.color = '#cfe0ff';
portalHintEl.style.textShadow = '0 2px 6px rgba(0,0,0,0.8)';
portalHintEl.style.opacity = '0';
portalHintEl.style.transition = 'opacity 0.3s';
portalHintEl.style.pointerEvents = 'none';
portalHintEl.style.zIndex = '6';
portalHintEl.style.maxWidth = '480px';
portalHintEl.style.textAlign = 'center';
portalHintEl.textContent = 'Spot the portal circle on another asteroid and press TAB to jump';
document.body.appendChild(portalHintEl);

// Marker ring on the asteroid surface where the player must stand to jump.
// Placed on the side facing the decor asteroid so the arc goes naturally up.
const FIELD_RADIUS = 4;
const jumpFieldCenter = new THREE.Vector3();
const jumpFieldUp = new THREE.Vector3(0, 1, 0); // surface normal at jumpFieldCenter
let jumpField: THREE.Mesh | null = null;
let jumpFieldReady = false;

// Per-ring transform constants — values arrived at via in-game tuning.
// `lift` = how far above the surface the ring centre sits.
// `tiltX/tiltY` = local rotation around the surface tangent axes (radians).
interface RingConfig {
  lift: number; tiltX: number; tiltY: number; majorR: number; tubeR: number;
}
const RED_RING:   RingConfig = { lift: 0.9, tiltX: -0.20, tiltY:  0.12, majorR: 4.6, tubeR: 0.16 };
const BLUE_RING:  RingConfig = { lift: 1.6, tiltX:  0.52, tiltY: -0.04, majorR: 4.6, tubeR: 0.28 };
const GREEN_RING: RingConfig = { lift: 0.7, tiltX: -0.08, tiltY:  0.20, majorR: 4.6, tubeR: 0.12 };

/**
 * Build a torus-shaped marker ring (3D donut, not a flat disc). A torus is
 * used instead of a flat RingGeometry so bumpy terrain can't slice it; the
 * polygonOffset + the per-ring lift remove any z-fighting.
 */
function buildFieldRing(color: number, surf: THREE.Vector3, surfaceUp: THREE.Vector3, cfg: RingConfig): THREE.Mesh {
  const geom = new THREE.TorusGeometry(cfg.majorR - cfg.tubeR, cfg.tubeR, 14, 56);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.75,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const ring = new THREE.Mesh(geom, mat);
  ring.renderOrder = 100;
  // Orient: torus axis aligned with surface up, then tilted by cfg.
  const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceUp);
  const tiltQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(cfg.tiltX, cfg.tiltY, 0));
  ring.quaternion.copy(baseQ).multiply(tiltQ);
  ring.position.copy(surf).addScaledVector(surfaceUp, cfg.lift);
  scene.add(ring);
  return ring;
}

function placeJumpField(): void {
  if (!decorAsteroid) return;
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  const dir = decorPos.clone().normalize();
  const surf = asteroidSurfacePoint(dir);
  if (!surf) return;
  jumpFieldCenter.copy(surf);
  jumpFieldUp.copy(dir);
  jumpField = buildFieldRing(0xff3030, surf, dir, RED_RING);
  jumpFieldReady = true;
}

// Mirror field on the second asteroid (placed at landing point so the player
// always arrives standing in it; press Tab to jump back).
const mirrorFieldCenter = new THREE.Vector3();
const mirrorFieldUp = new THREE.Vector3(0, 1, 0); // surface normal at mirrorFieldCenter (static)
let mirrorField: THREE.Mesh | null = null;
let mirrorFieldReady = false;
let onSecondAsteroid = false;
let onThirdAsteroid = false;
const secondAsteroidUp = new THREE.Vector3(0, 1, 0); // cached "up" of the player while on second (dynamic)

// Third (Toutatis) asteroid teleport ring. Same shape as the others but
// placed on the side facing decor #2 (so the player on second can see/aim
// at it across the gap).
const thirdFieldCenter = new THREE.Vector3();
const thirdFieldUp = new THREE.Vector3(0, 1, 0);
let thirdField: THREE.Mesh | null = null;
let thirdFieldReady = false;

type WorldId = 'first' | 'second' | 'third';
function currentWorldId(): WorldId {
  if (onThirdAsteroid) return 'third';
  if (onSecondAsteroid) return 'second';
  return 'first';
}
function setCurrentWorld(w: WorldId): void {
  onSecondAsteroid = w === 'second';
  onThirdAsteroid  = w === 'third';
}
function worldGravityCentre(w: WorldId, out: THREE.Vector3): void {
  if (w === 'second' && decorAsteroid) decorAsteroid.getWorldPosition(out);
  else if (w === 'third' && farAsteroid) farAsteroid.getWorldPosition(out);
  else out.set(0, 0, 0);
}
function worldGroundMesh(w: WorldId): THREE.Object3D | null {
  if (w === 'second') return decorAsteroid;
  if (w === 'third')  return farAsteroid;
  return asteroidMesh;
}
// Destination passed from startJump → finishJump.
let pendingDestWorld: WorldId | null = null;

function placeMirrorField(): void {
  if (!decorAsteroid) return;
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  // Surface point on the SECOND asteroid facing the FIRST one (= toward origin).
  // asteroidBoundingRadius is the MAX vertex distance, so along most directions
  // the actual surface is closer to the centre. Using `0.9 * R` as a constant
  // left the landing point floating in space ("hanging in orbit"). Raycast
  // against the decor mesh from outside (origin side) toward the decor centre
  // to get the true near-side surface point.
  const dirToFirst = decorPos.clone().normalize().negate();
  let surfPoint: THREE.Vector3 | null = null;
  {
    const ro = decorPos.clone().addScaledVector(dirToFirst, asteroidBoundingRadius * 2.5);
    const rd = dirToFirst.clone().negate(); // toward decor centre
    asteroidRaycaster.set(ro, rd);
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(decorAsteroid, true);
    if (hits[0]) surfPoint = hits[0].point.clone();
  }
  if (!surfPoint) {
    // Fallback: bbox approximation (shouldn't happen with a valid mesh).
    surfPoint = decorPos.clone().addScaledVector(dirToFirst, asteroidBoundingRadius * 0.9);
    console.warn('[mirrorField] decor raycast missed, using bbox fallback');
  } else {
    const dist = surfPoint.distanceTo(decorPos);
    console.log(`[mirrorField] decor surface at ${dist.toFixed(2)}m from decor centre (R=${asteroidBoundingRadius.toFixed(2)})`);
  }
  mirrorFieldCenter.copy(surfPoint);
  // The "up" at this surface point: outward normal away from decor centre.
  // Stored separately from `secondAsteroidUp` (which is the player's current
  // up while walking on decor — updated every frame).
  mirrorFieldUp.copy(surfPoint).sub(decorPos).normalize();
  secondAsteroidUp.copy(mirrorFieldUp);

  mirrorField = buildFieldRing(0x6ec3ff, surfPoint, mirrorFieldUp, BLUE_RING);
  mirrorFieldReady = true;
}

function placeThirdField(): void {
  if (!farAsteroid || !decorAsteroid) return;
  const farPos = new THREE.Vector3();
  farAsteroid.getWorldPosition(farPos);
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  // Surface point on Toutatis facing decor #2 — visible from second asteroid.
  const dirToSecond = decorPos.clone().sub(farPos).normalize();
  let surfPoint: THREE.Vector3 | null = null;
  {
    const ro = farPos.clone().addScaledVector(dirToSecond, asteroidBoundingRadius * 2.5);
    const rd = dirToSecond.clone().negate();
    asteroidRaycaster.set(ro, rd);
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(farAsteroid, true);
    if (hits[0]) surfPoint = hits[0].point.clone();
  }
  if (!surfPoint) {
    surfPoint = farPos.clone().addScaledVector(dirToSecond, asteroidBoundingRadius * 0.4);
    console.warn('[thirdField] far raycast missed, using bbox fallback');
  } else {
    const dist = surfPoint.distanceTo(farPos);
    console.log(`[thirdField] toutatis surface at ${dist.toFixed(2)}m from far centre`);
  }
  thirdFieldCenter.copy(surfPoint);
  thirdFieldUp.copy(surfPoint).sub(farPos).normalize();
  thirdField = buildFieldRing(0x80ff80, surfPoint, thirdFieldUp, GREEN_RING);
  thirdFieldReady = true;
}


interface AimedRing {
  worldId: WorldId;
  centre: THREE.Vector3;
  up: THREE.Vector3;
  alongDist: number;
}

// Per-frame scratch so the aim test doesn't allocate.
const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimToCentre = new THREE.Vector3();

/**
 * Aim-only jump trigger. Iterates all rings on OTHER worlds (the player's
 * own ring is excluded — proximity no longer counts) and returns the closest
 * one whose disc intersects the camera ray. Math distance test (not mesh
 * raycast) because the torus has a hollow centre.
 */
function getAimedRing(): AimedRing | null {
  const cur = currentWorldId();
  camera.getWorldPosition(_aimOrigin);
  camera.getWorldDirection(_aimDir);
  const candidates: { worldId: WorldId, centre: THREE.Vector3, up: THREE.Vector3, ready: boolean, radius: number }[] = [
    { worldId: 'first',  centre: jumpFieldCenter,   up: jumpFieldUp,   ready: jumpFieldReady,   radius: RED_RING.majorR  },
    { worldId: 'second', centre: mirrorFieldCenter, up: mirrorFieldUp, ready: mirrorFieldReady, radius: BLUE_RING.majorR },
    { worldId: 'third',  centre: thirdFieldCenter,  up: thirdFieldUp,  ready: thirdFieldReady,  radius: BLUE_RING.majorR },
  ];
  let best: AimedRing | null = null;
  for (const c of candidates) {
    if (!c.ready || c.worldId === cur) continue;
    _aimToCentre.subVectors(c.centre, _aimOrigin);
    const along = _aimToCentre.dot(_aimDir);
    if (along <= 0 || along > 1500) continue;
    const perpSq = _aimToCentre.lengthSq() - along * along;
    if (perpSq < c.radius * c.radius) {
      if (!best || along < best.alongDist) {
        best = { worldId: c.worldId, centre: c.centre, up: c.up, alongDist: along };
      }
    }
  }
  return best;
}

function isInJumpField(): boolean {
  if (isJumping) return false;
  return getAimedRing() != null;
}

function tickJumpField(): void {
  const t = performance.now() * 0.003;
  if (jumpField)   (jumpField.material as THREE.MeshBasicMaterial).opacity   = 0.4 + Math.sin(t) * 0.15;
  if (mirrorField) (mirrorField.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t + 1) * 0.15;
  if (thirdField)  (thirdField.material as THREE.MeshBasicMaterial).opacity  = 0.4 + Math.sin(t + 2) * 0.15;
  const aimed = isJumping ? null : getAimedRing();
  jumpHintEl.style.opacity = aimed ? '1' : '0';
  // Long hint: "find a portal circle on another asteroid" — appears only
  // when the player is standing inside their *own* world's ring and isn't
  // already aiming at another one.
  let inOwnRing = false;
  const cur = currentWorldId();
  if (!aimed && !isJumping) {
    if (cur === 'first'  && jumpFieldReady   && player.position.distanceTo(jumpFieldCenter)   < FIELD_RADIUS) inOwnRing = true;
    if (cur === 'second' && mirrorFieldReady && player.position.distanceTo(mirrorFieldCenter) < FIELD_RADIUS) inOwnRing = true;
    if (cur === 'third'  && thirdFieldReady  && player.position.distanceTo(thirdFieldCenter)  < FIELD_RADIUS) inOwnRing = true;
  }
  portalHintEl.style.opacity = inOwnRing ? '1' : '0';
}

// Start/end gravity centres for the in-flight up-vector interpolation.
// On the first asteroid the centre is the world origin; on the second it's
// the decor's world position. Setting `up = (pos - lerp(gravStart,gravEnd))
// .normalize()` each frame avoids the 180° camera snap at the endpoints.
const _gravStart = new THREE.Vector3();
const _gravEnd = new THREE.Vector3();
const _gravNow = new THREE.Vector3();

function startJump(): void {
  if (isJumping) return;
  const aimed = getAimedRing();
  if (!aimed) return;
  playJump();
  jumpStart.copy(player.position);
  jumpEnd.copy(aimed.centre);
  pendingDestWorld = aimed.worldId;
  // Source / destination gravity centres for the smooth up-vector lerp
  // mid-arc (no 180° snap when worlds have opposite up directions).
  worldGravityCentre(currentWorldId(), _gravStart);
  worldGravityCentre(aimed.worldId, _gravEnd);
  // Clear any plasma in flight — it was tracking the player to the old
  // body and shouldn't follow them through the arc.
  for (const p of projectiles) disposeProjectile(p);
  projectiles.length = 0;
  jumpMid.copy(jumpStart).add(jumpEnd).multiplyScalar(0.5);
  jumpUp.copy(jumpMid).normalize();
  jumpT = 0;
  isJumping = true;
  jumpHintEl.style.opacity = '0';
}

function finishJump(): void {
  const dest = pendingDestWorld;
  if (!dest) return;
  pendingDestWorld = null;
  setCurrentWorld(dest);
  // Lift the player up by PLAYER_RADIUS along the destination's surface up,
  // matching first-asteroid physics where player.position = surface + R.
  const destUp = dest === 'first'  ? player.position.clone().normalize()
              : dest === 'second' ? mirrorFieldUp
              :                     thirdFieldUp;
  if (dest !== 'first') {
    player.position.addScaledVector(destUp, PLAYER_RADIUS);
    if (dest === 'second') secondAsteroidUp.copy(destUp);
    // Pop the inspect animation as a "look at your gun" landing flourish.
    if (weapon) transitionPrimary(weapon, 'inspecting');
  }
  player.pitch = 0.10;
  player.velocity.set(0, 0, 0);

  // Greet the player with creatures on hostile-asteroid arrival.
  if (dest === 'second') {
    const aliveSpiders = spiders.reduce((n, s) => s.alive ? n + 1 : n, 0);
    if (aliveSpiders < 4) spawnInitialSpiders(4 - aliveSpiders);
    const aliveSecondTribrutes = tribrutes.reduce((n, t) => (t.alive && t.worldId === 'second' ? n + 1 : n), 0);
    if (aliveSecondTribrutes < 4) {
      // Top up tribrutes on second around the player.
      const decorPos = new THREE.Vector3();
      decorAsteroid?.getWorldPosition(decorPos);
      const playerUp = player.position.clone().sub(decorPos).normalize();
      const need = 4 - aliveSecondTribrutes;
      for (let k = 0; k < need; k++) {
        const random = new THREE.Vector3().randomDirection();
        const tangent = random.sub(playerUp.clone().multiplyScalar(random.dot(playerUp))).normalize();
        const angle = THREE.MathUtils.degToRad(40 + Math.random() * 110);
        const candidate = playerUp.clone().applyAxisAngle(tangent, angle);
        spawnTribrute(candidate, 'second');
      }
    }
  } else if (dest === 'third') {
    const aliveTribrutes = tribrutes.reduce((n, t) => (t.alive && t.worldId === 'third' ? n + 1 : n), 0);
    if (aliveTribrutes < 3) spawnInitialTribrutes(3 - aliveTribrutes);
  }
}

function tickJump(dt: number): boolean {
  if (!isJumping) return false;
  jumpT = Math.min(1, jumpT + dt / JUMP_DURATION);

  // Sine-bell arc above the straight-line interpolation.
  const arcK = Math.sin(jumpT * Math.PI);
  player.position.copy(jumpStart).lerp(jumpEnd, jumpT).addScaledVector(jumpUp, JUMP_ARC_HEIGHT * arcK);
  player.velocity.set(0, 0, 0);
  player.grounded = false;

  // Camera follows pose smoothly. Up vector is taken relative to a smoothly
  // shifting gravity centre — origin → decor on a forward jump, decor →
  // origin on a return — so the camera doesn't 180°-snap at either endpoint.
  _gravNow.copy(_gravStart).lerp(_gravEnd, jumpT);
  const eyeUp = player.position.clone().sub(_gravNow).normalize();
  camera.position.copy(player.position).addScaledVector(eyeUp, EYE_HEIGHT);
  camera.up.copy(eyeUp);
  // Build the surface-tangent basis at the current eyeUp using the same
  // hysteretic ref selector as tickPlayer to keep the camera basis stable.
  const t1b = new THREE.Vector3();
  buildStableTangent(eyeUp, t1b);
  const t2b = new THREE.Vector3().crossVectors(eyeUp, t1b).normalize();
  // Override yaw each frame so forward chases the destination. Without
  // this, the (t1b, t2b) basis rotates as eyeUp tilts mid-arc and the
  // stored yaw ends up pointing the player's forward 90°+ away from the
  // destination — feels like "flying backwards" toward the green ring.
  const toDest = jumpEnd.clone().sub(player.position);
  const tangentDest = toDest.clone().sub(eyeUp.clone().multiplyScalar(toDest.dot(eyeUp)));
  if (tangentDest.lengthSq() > 1e-3) {
    tangentDest.normalize();
    player.yaw = Math.atan2(t2b.dot(tangentDest), t1b.dot(tangentDest));
  }
  const forwardNow = t1b.clone().multiplyScalar(Math.cos(player.yaw)).addScaledVector(t2b, Math.sin(player.yaw));
  const rightNow = new THREE.Vector3().crossVectors(forwardNow, eyeUp).normalize();
  const lookDir = forwardNow.clone().applyAxisAngle(rightNow, player.pitch);
  camera.lookAt(camera.position.clone().add(lookDir));

  if (jumpT >= 1) {
    isJumping = false;
    finishJump();
  }
  return true;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (isInJumpField()) startJump();
  }
});


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

/**
 * Generic ground-finder: raycast against `mesh` from outside `centre` in the
 * direction of `pos`. Used for the second asteroid (decor) the same way
 * findGroundExact handles the first.
 */
function findGroundOnObject(
  pos: THREE.Vector3, centre: THREE.Vector3, mesh: THREE.Object3D
): { point: THREE.Vector3; up: THREE.Vector3 } | null {
  const rel = pos.clone().sub(centre);
  if (rel.lengthSq() < 1e-6) return null;
  const up = rel.normalize();
  // Primary: ray from way outside in `up` direction back toward the centre.
  const ro = centre.clone().addScaledVector(up, asteroidBoundingRadius * 4);
  const rd = up.clone().negate();
  asteroidRaycaster.set(ro, rd);
  asteroidRaycaster.far = asteroidBoundingRadius * 8;
  let hits = asteroidRaycaster.intersectObject(mesh, true);
  if (hits[0]) return { point: hits[0].point.clone(), up };
  // Fallback A: ray from the player's own position toward the centre.
  // Catches cases where the player has slipped just past a concavity edge
  // and the "above" raycast finds a different lobe instead of their feet.
  asteroidRaycaster.set(pos, rd);
  asteroidRaycaster.far = pos.distanceTo(centre) + asteroidBoundingRadius * 2;
  hits = asteroidRaycaster.intersectObject(mesh, true);
  if (hits[0]) return { point: hits[0].point.clone(), up };
  // Fallback B: ray from centre outward toward the player — useful when
  // they're INSIDE the mesh and the inward-pointing rays miss front faces.
  const roOut = centre.clone();
  asteroidRaycaster.set(roOut, up);
  asteroidRaycaster.far = asteroidBoundingRadius * 8;
  hits = asteroidRaycaster.intersectObject(mesh, true);
  if (hits[0]) return { point: hits[0].point.clone(), up };
  console.warn('[ground] raycast missed all 3 directions on', mesh.name || mesh.uuid.slice(0, 8));
  return null;
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
const FRAG_MAX_ACTIVE = 1200;       // hard cap across all shatters; drop oldest beyond this

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
  // Hard cap across all shatters — drop oldest fragments if we have too many.
  // Without this, rapid-fire shooting could pile up thousands of meshes.
  while (fragments.length > FRAG_MAX_ACTIVE) {
    const f = fragments.shift()!;
    scene.remove(f.mesh);
    f.mesh.geometry.dispose();
    (f.mesh.material as THREE.Material).dispose();
  }
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

// --- player HP & death screen --------------------------------------------

let playerHp = PLAYER_MAX_HP;
let playerDead = false;

const deathEl = document.createElement('div');
deathEl.style.position = 'fixed';
deathEl.style.inset = '0';
deathEl.style.display = 'flex';
deathEl.style.flexDirection = 'column';
deathEl.style.alignItems = 'center';
deathEl.style.justifyContent = 'center';
deathEl.style.background = 'rgba(0, 0, 0, 0.78)';
deathEl.style.color = '#ff5050';
deathEl.style.font = 'bold 96px ui-sans-serif, system-ui, sans-serif';
deathEl.style.textShadow = '0 6px 30px rgba(0,0,0,0.9), 0 0 40px rgba(255,80,80,0.45)';
deathEl.style.zIndex = '20';
deathEl.style.opacity = '0';
deathEl.style.pointerEvents = 'none';
deathEl.style.transition = 'opacity 0.6s ease-in-out';
deathEl.innerHTML = `
  <div>YOU DIED</div>
  <button id="restart-btn" style="
    margin-top: 32px; padding: 12px 28px; font: 600 18px ui-sans-serif, system-ui, sans-serif;
    background: #b03030; color: #fff; border: 0; border-radius: 8px; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  ">Restart</button>
`;
document.body.appendChild(deathEl);
document.getElementById('restart-btn')?.addEventListener('click', () => location.reload());

function refreshHpHud(): void {
  // HP shows up at top-left as part of the existing xpHud block.
  refreshXpHud();
}

// --- audio (procedural SFX via Web Audio API) -----------------------------
//
// All effects are synthesised on the fly — no asset files required, just a
// few oscillators and a noise burst. Toggle with `M`.

let _audioCtx: AudioContext | null = null;
let _masterGain: GainNode | null = null;
let _soundOn = false;

function audio(): { ctx: AudioContext; master: GainNode } | null {
  if (!_soundOn) return null;
  // Lazy-init on first use so the AudioContext is created in response to a
  // user gesture (browsers block context creation otherwise).
  if (!_audioCtx) {
    try {
      _audioCtx = new AudioContext();
      _masterGain = _audioCtx.createGain();
      _masterGain.gain.value = 0.6;
      _masterGain.connect(_audioCtx.destination);
    } catch {
      _soundOn = false;
      return null;
    }
  }
  return { ctx: _audioCtx, master: _masterGain! };
}

function sfxTone(freq: number, durSec: number, type: OscillatorType = 'sine', volume: number = 0.3, freqEnd?: number): void {
  const a = audio();
  if (!a) return;
  const { ctx, master } = a;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + durSec);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durSec);
  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + durSec + 0.05);
}

function sfxNoise(durSec: number, volume: number = 0.2, lowPassHz?: number): void {
  const a = audio();
  if (!a) return;
  const { ctx, master } = a;
  const now = ctx.currentTime;
  const samples = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  let chain: AudioNode = src;
  if (lowPassHz !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowPassHz;
    src.connect(filter);
    chain = filter;
  }
  chain.connect(gain).connect(master);
  src.start(now);
}

function playShoot():     void { sfxNoise(0.08, 0.35, 1200); sfxTone(70,  0.06, 'sawtooth', 0.4, 35); }
function playHit():       void { sfxTone(220, 0.06, 'square',   0.18, 110); }
function playHeadshot():  void { sfxTone(880, 0.05, 'square',   0.25); sfxTone(660, 0.10, 'square', 0.18); }
function playDamage():    void { sfxNoise(0.18, 0.45, 350); sfxTone(110, 0.15, 'sawtooth', 0.25, 60); }
function playPickup():    void {
  sfxTone(523.25, 0.07, 'sine', 0.3);
  setTimeout(() => sfxTone(659.25, 0.07, 'sine', 0.3),  70);
  setTimeout(() => sfxTone(783.99, 0.14, 'sine', 0.3), 140);
}
function playLevelUp():   void {
  [261.63, 329.63, 392.00, 523.25].forEach((f, i) =>
    setTimeout(() => sfxTone(f, 0.30, 'triangle', 0.3), i * 90));
}
function playDeath():     void { sfxTone(440, 1.2, 'sawtooth', 0.4, 60); }
function playJump():      void { sfxTone(220, 0.4, 'sine', 0.25, 660); }
function playMonsterDie(): void { sfxNoise(0.20, 0.30, 600); sfxTone(180, 0.18, 'sawtooth', 0.2, 60); }

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM') return;
  _soundOn = !_soundOn;
  console.log(`[sound] ${_soundOn ? 'ON' : 'OFF'}`);
});

function damagePlayer(amount: number = 1): void {
  if (playerDead) return;
  flashDamage();
  playDamage();
  playerHp = Math.max(0, playerHp - amount);
  refreshHpHud();
  if (playerHp === 0) {
    playerDead = true;
    playDeath();
    deathEl.style.opacity = '1';
    deathEl.style.pointerEvents = 'auto';
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// --- XP / score / "asteroid cleared" -------------------------------------

let totalXP = 0;
let walkersSpawned = 0;
let fliersSpawned = 0;
let walkersKilled = 0;
let fliersKilled = 0;
let headshotKills = 0;
let currentLevel = 1;

const xpHudEl = document.createElement('div');
xpHudEl.style.position = 'fixed';
xpHudEl.style.top = '8px';
xpHudEl.style.left = '8px';
xpHudEl.style.font = '600 16px/1.4 ui-monospace, monospace';
xpHudEl.style.color = '#ffd66e';
xpHudEl.style.background = 'rgba(0,0,0,0.45)';
xpHudEl.style.padding = '8px 12px';
xpHudEl.style.borderRadius = '4px';
xpHudEl.style.pointerEvents = 'none';
xpHudEl.style.minWidth = '220px';
xpHudEl.innerHTML = `
  <div id="hud-level">Level: 1</div>
  <div style="display: flex; align-items: center; gap: 6px; margin: 3px 0;">
    <span style="width: 28px;">HP:</span>
    <div style="flex: 1; height: 12px; background: #2a1010; border: 1px solid #5a2020; border-radius: 3px; overflow: hidden;">
      <div id="hp-fill" style="height: 100%; width: 100%; background: linear-gradient(90deg, #ff4040, #ff8060); transition: width 0.15s linear;"></div>
    </div>
    <span id="hp-num" style="width: 50px; text-align: right; color: #ff8a70; font-size: 13px;">20/20</span>
  </div>
  <div id="hud-xp">XP: 0</div>
  <div id="hud-kills">Kills: 0 / 65</div>
  <div id="hud-headshots">Headshots: 0</div>
`;
document.body.appendChild(xpHudEl);

const hudLevelEl     = xpHudEl.querySelector<HTMLElement>('#hud-level')!;
const hudHpFillEl    = xpHudEl.querySelector<HTMLElement>('#hp-fill')!;
const hudHpNumEl     = xpHudEl.querySelector<HTMLElement>('#hp-num')!;
const hudXpEl        = xpHudEl.querySelector<HTMLElement>('#hud-xp')!;
const hudKillsEl     = xpHudEl.querySelector<HTMLElement>('#hud-kills')!;
const hudHeadshotsEl = xpHudEl.querySelector<HTMLElement>('#hud-headshots')!;

function refreshXpHud(): void {
  const killed = walkersKilled + fliersKilled;
  hudLevelEl.textContent = `Level: ${currentLevel}`;
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_MAX_HP));
  hudHpFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
  // Tint the bar more red as HP drops; below 30% switch to a solid danger red.
  hudHpFillEl.style.background = ratio < 0.3
    ? '#ff2828'
    : 'linear-gradient(90deg, #ff4040, #ff8060)';
  hudHpNumEl.textContent = `${playerHp}/${PLAYER_MAX_HP}`;
  hudXpEl.textContent = `XP: ${totalXP}`;
  hudKillsEl.textContent = `Kills: ${killed} / ${TARGET_WALKERS + TARGET_FLIERS}`;
  hudHeadshotsEl.textContent = `Headshots: ${headshotKills}`;
}

// "Level Up!" centre-screen flash, mirrors the Asteroid-cleared element.
const levelUpEl = document.createElement('div');
levelUpEl.style.position = 'fixed';
levelUpEl.style.top = '32%';
levelUpEl.style.left = '50%';
levelUpEl.style.transform = 'translate(-50%, -50%)';
levelUpEl.style.font = 'bold 48px ui-sans-serif, system-ui, sans-serif';
levelUpEl.style.color = '#ffd66e';
levelUpEl.style.textShadow = '0 4px 14px rgba(0,0,0,0.85), 0 0 22px rgba(255,200,80,0.55)';
levelUpEl.style.opacity = '0';
levelUpEl.style.transition = 'opacity 0.35s ease-in-out';
levelUpEl.style.pointerEvents = 'none';
levelUpEl.style.zIndex = '7';
document.body.appendChild(levelUpEl);

let levelUpHideTimer: ReturnType<typeof setTimeout> | null = null;

function checkLevelUp(): void {
  let newLevel = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalXP >= LEVEL_THRESHOLDS[i]) newLevel = i + 1;
  }
  if (newLevel <= currentLevel) return;
  currentLevel = newLevel;
  playLevelUp();
  // +3 HP per level up (capped at max).
  const before = playerHp;
  playerHp = Math.min(PLAYER_MAX_HP, playerHp + 3);
  const hpGained = playerHp - before;
  // Instant magazine refill — interrupt any in-progress reload too.
  let ammoRefilled = false;
  if (weapon && weapon.ammo < MAG_SIZE) {
    weapon.ammo = MAG_SIZE;
    weapon.reloading = false;
    weapon.primaryTimer = 0;
    if (weapon.primary === 'reloading') transitionPrimary(weapon, 'idle');
    updateAmmoHud();
    ammoRefilled = true;
  }
  refreshXpHud();
  const lines: string[] = [];
  if (hpGained > 0)   lines.push(`<div style="font-size:22px;color:#aef0a8;margin-top:6px;">+${hpGained} HP</div>`);
  if (ammoRefilled)   lines.push(`<div style="font-size:22px;color:#ffd66e;margin-top:2px;">Mag reloaded</div>`);
  levelUpEl.innerHTML = `Level Up!  ${currentLevel}${lines.join('')}`;
  levelUpEl.style.opacity = '1';
  if (levelUpHideTimer) clearTimeout(levelUpHideTimer);
  levelUpHideTimer = setTimeout(() => { levelUpEl.style.opacity = '0'; }, 1800);
}

const clearedEl = document.createElement('div');
clearedEl.style.position = 'fixed';
clearedEl.style.top = '40%';
clearedEl.style.left = '50%';
clearedEl.style.transform = 'translate(-50%, -50%)';
clearedEl.style.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
clearedEl.style.color = '#fff';
clearedEl.style.textShadow = '0 4px 16px rgba(0,0,0,0.85), 0 0 24px rgba(255,200,80,0.6)';
clearedEl.style.opacity = '0';
clearedEl.style.transition = 'opacity 1.0s ease-in-out';
clearedEl.style.pointerEvents = 'none';
clearedEl.style.zIndex = '6';
clearedEl.textContent = 'Asteroid 1 cleared';
document.body.appendChild(clearedEl);

let asteroidCleared = false;
function checkClear(): void {
  if (asteroidCleared) return;
  if (walkersKilled >= TARGET_WALKERS && fliersKilled >= TARGET_FLIERS) {
    asteroidCleared = true;
    clearedEl.style.opacity = '1';
  }
}

// Floating "+N XP" sprite spawned at the kill point; drifts up & fades.
interface XpPopup { sprite: THREE.Sprite; life: number; maxLife: number }
const xpPopups: XpPopup[] = [];

function spawnXpPopup(worldPos: THREE.Vector3, amount: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#ffd542';
  const text = `+${amount} XP`;
  ctx.strokeText(text, 128, 48);
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.0, 0.75, 1);
  sprite.position.copy(worldPos);
  sprite.renderOrder = 999;
  scene.add(sprite);
  xpPopups.push({ sprite, life: 0, maxLife: 1.4 });
}

function tickXpPopups(dt: number): void {
  for (let i = xpPopups.length - 1; i >= 0; i--) {
    const p = xpPopups[i];
    p.life += dt;
    // float along radial (planet up)
    _scratchUp.copy(p.sprite.position).normalize();
    p.sprite.position.addScaledVector(_scratchUp, dt * 1.6);
    const t = p.life / p.maxLife;
    (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t);
    if (p.life >= p.maxLife) {
      scene.remove(p.sprite);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
      xpPopups.splice(i, 1);
    }
  }
}

// "Headshot!" floating sprite — shares the xpPopups list so it drifts/fades
// the same way (one tick loop, one cleanup path).
function spawnHpPopup(worldPos: THREE.Vector3): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 52px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#7df27d';
  const text = '+1 HP';
  ctx.strokeText(text, 128, 48);
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.0, 0.75, 1);
  sprite.position.copy(worldPos);
  sprite.renderOrder = 999;
  scene.add(sprite);
  xpPopups.push({ sprite, life: 0, maxLife: 1.4 });
}

function spawnHeadshotPopup(worldPos: THREE.Vector3): void {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#ff5050';
  const text = 'HEADSHOT!';
  ctx.strokeText(text, 192, 48);
  ctx.fillText(text, 192, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 0.75, 1);
  // Lift the popup a bit above the hit point so it appears over the head
  // rather than at the bullet impact.
  const up = worldPos.clone().normalize();
  sprite.position.copy(worldPos).addScaledVector(up, 0.6);
  sprite.renderOrder = 1000;
  scene.add(sprite);
  xpPopups.push({ sprite, life: 0, maxLife: 1.8 });
}

// --- HP pickups -----------------------------------------------------------
//
// Drop on monster death with HP_PICKUP_DROP_CHANCE probability. Hover above
// the death spot, slowly bob and spin. Walk near one to gain +1 HP.

interface HpPickup {
  group: THREE.Object3D;
  position: THREE.Vector3;     // base anchor on the surface
  worldId: WorldId;            // which asteroid it lives on
  life: number;
  bobPhase: number;
}

const HP_PICKUP_LIFETIME    = 30;       // seconds before despawning unclaimed
const HP_PICKUP_PICK_RADIUS = 1.8;
const HP_PICKUP_HOVER       = 1.2;
const HP_PICKUP_DROP_CHANCE = 0.30;

const hpPickups: HpPickup[] = [];

function buildHpPickupVisual(): THREE.Object3D {
  const wrap = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff5050, emissive: 0xff2020, emissiveIntensity: 1.6,
    roughness: 0.3, metalness: 0,
  });
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.22), mat);
  const vertical   = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), mat);
  wrap.add(horizontal);
  wrap.add(vertical);
  return wrap;
}

function spawnHpPickupAt(worldPos: THREE.Vector3, worldId: WorldId): void {
  const group = buildHpPickupVisual();
  scene.add(group);
  hpPickups.push({
    group, position: worldPos.clone(), worldId,
    life: 0, bobPhase: Math.random() * Math.PI * 2,
  });
}

/** Probabilistically drop an HP pickup at the given death point. */
function maybeDropHpPickup(worldPos: THREE.Vector3, worldId: WorldId): void {
  if (Math.random() >= HP_PICKUP_DROP_CHANCE) return;
  spawnHpPickupAt(worldPos, worldId);
}

function despawnHpPickup(p: HpPickup, idxHint?: number): void {
  scene.remove(p.group);
  p.group.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat.dispose();
    }
  });
  const idx = idxHint ?? hpPickups.indexOf(p);
  if (idx >= 0) hpPickups.splice(idx, 1);
}

function tickHpPickups(dt: number): void {
  const cur = currentWorldId();
  const centre = new THREE.Vector3();
  for (let i = hpPickups.length - 1; i >= 0; i--) {
    const p = hpPickups[i];
    p.life += dt;
    if (p.life >= HP_PICKUP_LIFETIME) { despawnHpPickup(p, i); continue; }
    // Hide on a different world to skip rendering cost — but the lifetime
    // timer keeps ticking so they don't accumulate.
    if (p.worldId !== cur) {
      p.group.visible = false;
      continue;
    }
    p.group.visible = true;
    p.bobPhase += dt * 1.8;
    worldGravityCentre(p.worldId, centre);
    const up = p.position.clone().sub(centre).normalize();
    const bob = Math.sin(p.bobPhase) * 0.18;
    p.group.position.copy(p.position).addScaledVector(up, HP_PICKUP_HOVER + bob);
    // Spin around the local up.
    p.group.up.copy(up);
    p.group.rotateOnAxis(up, dt * 1.6);
    // Player proximity → collect.
    if (player.position.distanceTo(p.group.position) < HP_PICKUP_PICK_RADIUS) {
      if (playerHp < PLAYER_MAX_HP) {
        playerHp = Math.min(PLAYER_MAX_HP, playerHp + 1);
        refreshXpHud();
        spawnHpPopup(p.group.position);
        playPickup();
      }
      despawnHpPickup(p, i);
    }
  }
}

function awardXp(m: Monster, hitPoint: THREE.Vector3, headshot: boolean = false): void {
  const reward = headshot
    ? XP_PER_HEADSHOT
    : (m.kind === 'flier' ? XP_PER_FLIER : XP_PER_WALKER);
  totalXP += reward;
  if (m.kind === 'flier') fliersKilled++;
  else                    walkersKilled++;
  if (headshot) headshotKills++;
  if (headshot) playHeadshot(); else playMonsterDie();
  refreshXpHud();
  spawnXpPopup(hitPoint, reward);
  checkLevelUp();
  checkClear();
  // Drop pickups on the ground. Fliers die in the air — project the body
  // down to the asteroid surface in the same direction so the pickup ends
  // up reachable instead of floating where the flier was hovering.
  let dropPos = m.position;
  if (m.kind === 'flier') {
    const up = m.position.clone().normalize();
    const surf = asteroidSurfacePoint(up);
    if (surf) dropPos = surf;
  }
  maybeDropHpPickup(dropPos, 'first');
}

// --- HP bar (canvas-textured sprite) --------------------------------------

const HP_BAR_W = 0.6;
const HP_BAR_H = 0.08;

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
  obj: THREE.Object3D;     // either the glb clone or the fallback sphere mesh
  light: THREE.PointLight;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spinAxis: THREE.Vector3;
  spinRate: number;
}

const projectiles: Projectile[] = [];

// Loaded once at boot; used as a template for each projectile via clone(true).
// Falls back to a plain emissive sphere if the model isn't present.
let projectileTemplate: THREE.Object3D | null = null;
const PROJECTILE_VISUAL_RADIUS = 0.26; // longest-dim ≈ 2× this; was 0.30 sphere

async function loadProjectileTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}projectile.glb`); }
  catch {
    console.log('[projectile] template not present — using sphere fallback');
    return;
  }
  const root = gltf.scene;
  // Normalize size: fit longest bbox dim to 2 * PROJECTILE_VISUAL_RADIUS.
  const tmpRoot = new THREE.Group();
  tmpRoot.add(root);
  tmpRoot.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(tmpRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // Center the mesh on its origin so it spins / lights symmetrically.
  root.position.sub(center);
  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar((PROJECTILE_VISUAL_RADIUS * 2) / maxDim);
  // Punch up emissive so the projectile reads as glowing plasma rather than a
  // dim prop in the asteroid's sun light.
  wrap.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      if (!mat.emissive) continue;
      if (mat.emissiveIntensity < 1) mat.emissiveIntensity = 1.6;
      if (!mat.emissiveMap && mat.map) mat.emissiveMap = mat.map;
      if (mat.emissive.getHex() === 0) mat.emissive = new THREE.Color(0x60a0ff);
    }
  });
  projectileTemplate = wrap;
  console.log(`[projectile] template loaded (scale=${((PROJECTILE_VISUAL_RADIUS * 2) / maxDim).toFixed(3)})`);
}

function buildProjectileVisual(): THREE.Object3D {
  if (projectileTemplate) return projectileTemplate.clone(true);
  // Fallback: original glowing blue sphere.
  const geom = new THREE.SphereGeometry(0.30, 14, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88c8ff, emissive: 0x4080ff, emissiveIntensity: 2.0,
    roughness: 0.25, metalness: 0,
  });
  return new THREE.Mesh(geom, mat);
}

function fireProjectile(from: THREE.Vector3, target: THREE.Vector3): void {
  const dir = target.clone().sub(from).normalize();
  const obj = buildProjectileVisual();
  obj.position.copy(from);
  scene.add(obj);

  const light = new THREE.PointLight(0x60a0ff, 2.0, 6, 1.5);
  obj.add(light);

  projectiles.push({
    obj, light,
    velocity: dir.multiplyScalar(FLIER_PROJECTILE_SPEED),
    life: 0,
    maxLife: 4.0,
    spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    spinRate: 4 + Math.random() * 4, // rad/s
  });
}

function disposeProjectile(p: Projectile): void {
  scene.remove(p.obj);
  // Geometry/material come from the shared template clone — only dispose the
  // fallback sphere where we own the resources outright.
  if (!projectileTemplate && p.obj instanceof THREE.Mesh) {
    p.obj.geometry.dispose();
    (p.obj.material as THREE.Material).dispose();
  }
}

function tickProjectiles(dt: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.obj.position.addScaledVector(p.velocity, dt);
    p.obj.rotateOnAxis(p.spinAxis, p.spinRate * dt);
    p.life += dt;

    // collision with player
    const dist = p.obj.position.distanceTo(player.position);
    if (dist < PROJECTILE_HIT_DIST) {
      damagePlayer(1);
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
  bodyAnchor: THREE.Object3D | null;
}

const monsters: Monster[] = [];

async function loadMonsterTemplate(): Promise<void> {
  monsterTemplate = await loadCreatureTemplate('monster.glb',   MONSTER_HEIGHT, 'walker');
  // Fliers used to be a Wyvern (flier.glb) — swapped to the Eyebeast model.
  // Its only animation is "Take 001"; the regex in loadCreatureTemplate falls
  // back to clips[0] when no walk/fly clip name matches, so it picks up
  // "Take 001" as the looping flight animation automatically.
  flierTemplate   = await loadCreatureTemplate('eyebeast.glb',  FLIER_HEIGHT,   'flier');
}

// --- eyebeasts (ambient hovering creatures on the second asteroid) --------

interface EyebeastTemplate {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  scale: number;
  baseY: number;
  centerXZ: { x: number; z: number };
}

interface Eyebeast {
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  position: THREE.Vector3;
  bobPhase: number;
}

const EYEBEAST_HEIGHT = 2.4;
const EYEBEAST_HOVER_ALT = 4;
const EYEBEAST_COUNT = 5;
let eyebeastTemplate: EyebeastTemplate | null = null;
const eyebeasts: Eyebeast[] = [];

async function loadEyebeastTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}eyebeast.glb`); }
  catch (e) { console.warn('[eyebeast] load failed:', e); return; }

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(root);
  if (bbox.isEmpty()) return;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const heightAxis = Math.max(size.x, size.y, size.z);
  const scale = EYEBEAST_HEIGHT / (heightAxis || 1);

  eyebeastTemplate = {
    root, clips: gltf.animations, scale,
    baseY: -bbox.min.y, centerXZ: { x: center.x, z: center.z },
  };
  console.log(`[eyebeast] template loaded: scale=${scale.toFixed(2)} clips=[${gltf.animations.map(c => `${c.name}/${c.duration.toFixed(2)}s`).join(', ')}]`);
}

function spawnEyebeasts(): void {
  if (!eyebeastTemplate || !decorAsteroid) return;
  const tpl = eyebeastTemplate;
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  // Pick the first clip (the model only has "Take 001"; fall through to
  // searching by name for robustness if it's ever extended).
  const clip = tpl.clips.find(c => /take\s*001/i.test(c.name)) ?? tpl.clips[0];

  let placed = 0;
  for (let attempt = 0; attempt < EYEBEAST_COUNT * 4 && placed < EYEBEAST_COUNT; attempt++) {
    const dir = new THREE.Vector3().randomDirection();
    // Raycast against the decor mesh to land the eyebeast above its actual surface.
    const ro = decorPos.clone().addScaledVector(dir, asteroidBoundingRadius * 2.5);
    const rd = dir.clone().negate();
    asteroidRaycaster.set(ro, rd);
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(decorAsteroid, true);
    if (!hits[0]) continue;
    const surfPoint = hits[0].point;
    const up = surfPoint.clone().sub(decorPos).normalize();
    const position = surfPoint.clone().addScaledVector(up, EYEBEAST_HOVER_ALT);

    const inst = cloneSkeleton(tpl.root) as THREE.Object3D;
    inst.position.set(-tpl.centerXZ.x, tpl.baseY, -tpl.centerXZ.z);
    const wrap = new THREE.Group();
    wrap.add(inst);
    wrap.scale.setScalar(tpl.scale);
    wrap.position.copy(position);
    // Align the model's local +Y with the surface normal so the eyebeast
    // floats upright instead of lying on its side. (`Object3D.up` is only a
    // hint for lookAt — by itself it doesn't rotate anything.)
    wrap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    // Random yaw around local up so the five don't all face the same way.
    wrap.rotateY(Math.random() * Math.PI * 2);
    wrap.traverse(c => { c.visible = true; c.frustumCulled = false; });
    scene.add(wrap);

    const mixer = new THREE.AnimationMixer(inst);
    if (clip) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.time = Math.random() * clip.duration; // desync the herd
      action.play();
    }

    eyebeasts.push({
      group: wrap, mixer, position,
      bobPhase: Math.random() * Math.PI * 2,
    });
    placed++;
  }
  console.log(`[eyebeast] spawned ${placed}/${EYEBEAST_COUNT}`);
}

function tickEyebeasts(dt: number): void {
  for (const e of eyebeasts) e.mixer.update(dt);
}

// --- spiders (second-asteroid hostile creatures) --------------------------

interface SpiderTemplate {
  root: THREE.Object3D;
  walkClip: THREE.AnimationClip | null;     // subjectAction
  attackClip: THREE.AnimationClip | null;   // ArmatureAction
  scale: number;
  baseY: number;
  centerXZ: { x: number; z: number };
}

interface Spider {
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | null;
  walkAction: THREE.AnimationAction | null;
  attackAction: THREE.AnimationAction | null;
  state: 'idle' | 'walking' | 'attacking';
  attackCooldown: number;
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  hpBar: THREE.Sprite;
  hpBarCanvas: HTMLCanvasElement;
  hpBarTexture: THREE.CanvasTexture;
  hpRatioDrawn: number;
  bodyAnchor: THREE.Object3D | null;     // bone driving the visible body, for HP bar tracking
}

const SPIDER_HEIGHT          = 3.2;   // bigger spiders — easier to spot/aim
const SPIDER_MAX_HP          = 5;
const SPIDER_MAX_ALIVE       = 6;     // halved — second now hosts tribrutes too
const SPIDER_LIFETIME_TOTAL  = 50;
const SPIDER_SPEED           = 2.2;
const SPIDER_ATTACK_RANGE    = 2.0;
const SPIDER_ATTACK_INTERVAL = 1.4;
const SPIDER_SPAWN_INTERVAL  = 2.0;
const SPIDER_XP_REWARD       = 30;
let spidersSpawnedTotal = 0;

let spiderTemplate: SpiderTemplate | null = null;
const spiders: Spider[] = [];
let spiderSpawnAccum = 0;

async function loadSpiderTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}spider.glb`); }
  catch (e) { console.warn('[spider] load failed:', e); return; }

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(root);
  if (bbox.isEmpty()) return;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const heightAxis = Math.max(size.x, size.y, size.z);
  const scale = SPIDER_HEIGHT / (heightAxis || 1);

  const walkClip = gltf.animations.find(c => /subjectAction/i.test(c.name)) ?? null;
  const attackClip = gltf.animations.find(c => /ArmatureAction/i.test(c.name)) ?? null;

  spiderTemplate = {
    root, walkClip, attackClip, scale,
    baseY: -bbox.min.y, centerXZ: { x: center.x, z: center.z },
  };
  console.log(`[spider] template loaded: scale=${scale.toFixed(2)} walk="${walkClip?.name}" attack="${attackClip?.name}"`);
}

/** Raycast against the decor mesh in `dir` (from the decor centre); returns
 *  the surface point or null. */
function decorSurfacePoint(decorPos: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
  if (!decorAsteroid) return null;
  const ro = decorPos.clone().addScaledVector(dir, asteroidBoundingRadius * 2.5);
  const rd = dir.clone().negate();
  asteroidRaycaster.set(ro, rd);
  asteroidRaycaster.far = asteroidBoundingRadius * 5;
  const hits = asteroidRaycaster.intersectObject(decorAsteroid, true);
  return hits[0]?.point.clone() ?? null;
}

function spawnSpider(dir: THREE.Vector3): void {
  if (!spiderTemplate || !decorAsteroid) return;
  if (spidersSpawnedTotal >= SPIDER_LIFETIME_TOTAL) return;
  const tpl = spiderTemplate;
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  const surfPoint = decorSurfacePoint(decorPos, dir);
  if (!surfPoint) return;

  const inst = cloneSkeleton(tpl.root) as THREE.Object3D;
  inst.position.set(-tpl.centerXZ.x, tpl.baseY, -tpl.centerXZ.z);
  const wrap = new THREE.Group();
  wrap.add(inst);
  wrap.scale.setScalar(tpl.scale);
  const up = surfPoint.clone().sub(decorPos).normalize();
  wrap.position.copy(surfPoint);
  wrap.up.copy(up);
  wrap.traverse(c => { c.visible = true; c.frustumCulled = false; });
  // Per-instance: huge raycast bounding sphere so animated meshes don't
  // pass under bullets due to broad-phase rejection.
  relaxSkinnedRaycastBounds(wrap);
  const bodyAnchor = findBodyAnchor(inst);
  scene.add(wrap);

  const mixer = new THREE.AnimationMixer(inst);
  // The model has two clips:
  //   subjectAction  — calm idle/sit
  //   ArmatureAction — forward lunge (used for chasing AND attacking)
  // Three actions are bound; only one plays at a time via setSpiderState.
  const idleAction   = tpl.walkClip   ? mixer.clipAction(tpl.walkClip)   : null;
  const walkAction   = tpl.attackClip ? mixer.clipAction(tpl.attackClip) : null;
  const attackAction = walkAction; // same clip, same action handle
  if (idleAction) {
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.time = Math.random() * (tpl.walkClip?.duration ?? 1);
    idleAction.play();
  }

  // HP bar above the spider.
  const { sprite: hpBar, canvas: hpBarCanvas, texture: hpBarTexture } = makeHpBar();
  scene.add(hpBar);

  spiders.push({
    group: wrap, mixer,
    idleAction, walkAction, attackAction,
    state: 'idle',
    attackCooldown: 0,
    position: surfPoint,
    hp: SPIDER_MAX_HP,
    maxHp: SPIDER_MAX_HP,
    alive: true,
    hpBar, hpBarCanvas, hpBarTexture, hpRatioDrawn: 1,
    bodyAnchor,
  });
  spidersSpawnedTotal++;
}

function setSpiderState(s: Spider, state: Spider['state']): void {
  if (s.state === state) return;
  s.state = state;
  // Idle uses subjectAction; walking/attacking share ArmatureAction (same
  // handle), so transitioning between them is a no-op visually.
  if (state === 'idle') {
    if (s.walkAction)   s.walkAction.fadeOut(0.15);
    if (s.idleAction)   s.idleAction.reset().fadeIn(0.15).play();
  } else {
    if (s.idleAction)   s.idleAction.fadeOut(0.15);
    if (s.walkAction)   s.walkAction.reset().fadeIn(0.15).play();
  }
}

function tickSpiderSpawner(dt: number): void {
  if (!spiderTemplate || !decorAsteroid) return;
  // Only spawn while the player is on the second asteroid.
  if (!onSecondAsteroid) return;
  spiderSpawnAccum += dt;
  if (spiderSpawnAccum < SPIDER_SPAWN_INTERVAL) return;
  spiderSpawnAccum = 0;

  const aliveCount = spiders.reduce((n, s) => s.alive ? n + 1 : n, 0);
  if (aliveCount >= SPIDER_MAX_ALIVE) return;

  // Pick a direction not too close to the player's view (reuse the same
  // anti-pop-in heuristic as the first-asteroid spawner).
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  for (let i = 0; i < 16; i++) {
    const candidate = new THREE.Vector3().randomDirection();
    const surfPoint = decorSurfacePoint(decorPos, candidate);
    if (!surfPoint) continue;
    const toSpawn = surfPoint.clone().sub(player.position).normalize();
    if (toSpawn.dot(camForward) < MONSTER_SPAWN_PLAYER_DOT) {
      spawnSpider(candidate);
      console.log(`[spider] trickle spawn (alive: ${aliveCount + 1}/${SPIDER_MAX_ALIVE})`);
      return;
    }
  }
}

/** Pre-spawn N spiders scattered around decor at boot, before the player has
 *  visited. Picks random surface directions (no player reference). */
function prespawnSpiders(count: number): void {
  if (!spiderTemplate || !decorAsteroid) return;
  let placed = 0;
  for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
    const dir = new THREE.Vector3().randomDirection();
    const before = spiders.length;
    spawnSpider(dir);
    if (spiders.length > before) placed++;
  }
  console.log(`[spider] prespawn ${placed}/${count}`);
}

/** Drop a handful of spiders around the player on first arrival at the
 *  second asteroid. Without this you have to wait minutes for the trickle
 *  spawner to walk one over from the far side of decor. */
function spawnInitialSpiders(count: number): void {
  if (!spiderTemplate || !decorAsteroid) return;
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  // Fan out around the player's "up" by random tangent offsets.
  const playerUp = player.position.clone().sub(decorPos).normalize();
  let placed = 0;
  for (let attempt = 0; attempt < count * 6 && placed < count; attempt++) {
    // Random tangent direction in the plane perpendicular to playerUp.
    const random = new THREE.Vector3().randomDirection();
    const tangent = random.sub(playerUp.clone().multiplyScalar(random.dot(playerUp))).normalize();
    // Tilt the candidate direction (= player's outward dir) by 30-150° around
    // the tangent so spawns ring around the player on decor's surface.
    const angle = THREE.MathUtils.degToRad(30 + Math.random() * 120);
    const candidate = playerUp.clone().applyAxisAngle(tangent, angle);
    spawnSpider(candidate);
    placed++;
  }
  console.log(`[spider] initial spawn ${placed}/${count}`);
}

// Frame counter for cheap "every N frames" throttles (surface raycast etc).
let _spiderFrame = 0;

function tickSpiders(dt: number): void {
  if (!decorAsteroid) return;
  const onSecond = currentWorldId() === 'second';
  // When the player is somewhere else, hide every spider entirely. Skips
  // GPU skinning of 12 × 67k-vertex meshes per frame — biggest single perf
  // win since a 67k spider is the heaviest model in the scene.
  if (!onSecond) {
    for (const s of spiders) {
      s.group.visible = false;
      s.hpBar.visible = false;
    }
    return;
  }
  const decorPos = new THREE.Vector3();
  decorAsteroid.getWorldPosition(decorPos);
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  _spiderFrame++;

  for (let i = spiders.length - 1; i >= 0; i--) {
    const s = spiders[i];
    if (!s.alive) continue;

    s.group.visible = true;
    // Animation LOD: spiders far from the player update their mixer at half
    // rate (every other frame at 2× dt). Skinned-mesh skeleton math is the
    // dominant CPU cost when there are 12 of them on-screen.
    const distSq = s.position.distanceToSquared(player.position);
    let mixerDt = dt;
    if (distSq > 30 * 30) mixerDt = (i + _spiderFrame) % 2 === 0 ? dt * 2 : 0;
    if (mixerDt > 0) s.mixer.update(mixerDt);

    if (s.attackCooldown > 0) s.attackCooldown -= dt;
    const toPlayer = player.position.clone().sub(s.position);
    const dist = Math.sqrt(distSq);

    if (dist <= SPIDER_ATTACK_RANGE) {
      setSpiderState(s, 'attacking');
      if (s.attackCooldown <= 0) {
        s.attackCooldown = SPIDER_ATTACK_INTERVAL;
        damagePlayer(1);
      }
    } else {
      setSpiderState(s, 'walking');
      const up = s.position.clone().sub(decorPos).normalize();
      const tangent = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
      if (tangent.lengthSq() > 1e-6) {
        tangent.normalize();
        s.position.addScaledVector(tangent, SPIDER_SPEED * dt);
        // Re-clamp to decor surface every 4th frame (with a per-spider phase
        // so we don't re-raycast all 12 in one frame). Spiders move ~9cm/frame
        // — clamping every 4 frames means up to ~36cm drift before re-snap,
        // imperceptible against decor's bumpy surface.
        if ((_spiderFrame + i) % 4 === 0) {
          const newUp = s.position.clone().sub(decorPos).normalize();
          const surf = decorSurfacePoint(decorPos, newUp);
          if (surf) s.position.copy(surf);
        }
      }
    }

    const stand = s.position.clone().sub(decorPos).normalize();
    s.group.position.copy(s.position);
    s.group.up.copy(stand);
    s.group.lookAt(s.position.clone().add(toPlayer));
    tickSpiderHpBar(s, decorPos, camPos);
  }
}

function tickSpiderHpBar(s: Spider, decorPos: THREE.Vector3, camPos: THREE.Vector3): void {
  const ratio = Math.max(0, s.hp / s.maxHp);
  if (Math.abs(ratio - s.hpRatioDrawn) > 0.005) {
    drawHpBar(s.hpBarCanvas, ratio);
    s.hpBarTexture.needsUpdate = true;
    s.hpRatioDrawn = ratio;
  }
  // Anchor on the rig's body bone if available — the wrap.position can drift
  // away from the rendered mesh when the rig has root-motion translation.
  const anchorPos = _scratchAnchor;
  if (s.bodyAnchor) s.bodyAnchor.getWorldPosition(anchorPos);
  else anchorPos.copy(s.position);
  const up = anchorPos.clone().sub(decorPos).normalize();
  s.hpBar.position.copy(anchorPos).addScaledVector(up, SPIDER_HEIGHT * 0.3 + 0.3);
  const distToCam = s.hpBar.position.distanceTo(camPos);
  const k = Math.min(1, distToCam / 5);
  s.hpBar.scale.set(HP_BAR_W * k, HP_BAR_H * k, 1);
  s.hpBar.visible = s.alive;
}

function damageSpider(s: Spider, hitPoint: THREE.Vector3): void {
  if (!s.alive) return;
  s.hp -= 1;
  if (s.hp > 0) { playHit(); return; }
  s.alive = false;
  playMonsterDie();
  // XP + popup, mirrors awardXp for monsters.
  totalXP += SPIDER_XP_REWARD;
  walkersKilled++;
  refreshXpHud();
  spawnXpPopup(hitPoint, SPIDER_XP_REWARD);
  checkLevelUp();
  maybeDropHpPickup(s.position, 'second');
  shatterSpider(s, hitPoint);
}

/** Per-triangle shatter for a spider, mirrors shatterMonster but for the
 *  Spider type. The model has 67k faces; FRAG_MAX_PER_SHATTER caps the
 *  fragment count, so we end up with the same ~400 polygons regardless. */
// --- tribrutes (third-asteroid hostile creatures) -------------------------

interface TribruteTemplate {
  root: THREE.Object3D;
  idleClip: THREE.AnimationClip | null;
  runClip: THREE.AnimationClip | null;
  attackClip: THREE.AnimationClip | null;
  dieClip: THREE.AnimationClip | null;
  scale: number;
  baseY: number;
  centerXZ: { x: number; z: number };
}

interface Tribrute {
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | null;
  runAction: THREE.AnimationAction | null;
  attackAction: THREE.AnimationAction | null;
  dieAction: THREE.AnimationAction | null;
  state: 'idle' | 'run' | 'attack' | 'dying';
  attackCooldown: number;
  dyingTimer: number;
  position: THREE.Vector3;
  worldId: WorldId;     // which asteroid this tribrute lives on ('second' or 'third')
  hp: number;
  maxHp: number;
  alive: boolean;
  hpBar: THREE.Sprite;
  hpBarCanvas: HTMLCanvasElement;
  hpBarTexture: THREE.CanvasTexture;
  hpRatioDrawn: number;
  bodyAnchor: THREE.Object3D | null;
}

const TRIBRUTE_HEIGHT          = 2.2;  // 2.0 × 1.10 (size bump)
const TRIBRUTE_MAX_HP          = 5;    // 5 shots to kill
const TRIBRUTE_LIFETIME_TOTAL  = 60;
// Per-world alive cap. Second already has spiders, so don't pile too many on.
const tribruteCapFor = (w: WorldId) => w === 'second' ? 6 : 12;
const TRIBRUTE_SPEED           = 2.6;
const TRIBRUTE_AGGRO_RANGE     = 28;
const TRIBRUTE_ATTACK_RANGE    = 1.8;
const TRIBRUTE_ATTACK_INTERVAL = 1.3;
const TRIBRUTE_SPAWN_INTERVAL  = 2.5;
const TRIBRUTE_XP_REWARD       = 40;
let tribrutesSpawnedTotal = 0;

let tribruteTemplate: TribruteTemplate | null = null;
const tribrutes: Tribrute[] = [];
let tribruteSpawnAccum = 0;

async function loadTribruteTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}tribrute.glb`); }
  catch (e) { console.warn('[tribrute] load failed:', e); return; }

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(root);
  if (bbox.isEmpty()) return;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const heightAxis = Math.max(size.x, size.y, size.z);
  const scale = TRIBRUTE_HEIGHT / (heightAxis || 1);

  const find = (re: RegExp) => gltf.animations.find(c => re.test(c.name)) ?? null;
  const idleClip   = find(/idle/i);
  const runClip    = find(/run/i);
  const attackClip = find(/attack1/i) ?? find(/attack/i);
  const dieClip    = find(/die|death/i);

  tribruteTemplate = {
    root, idleClip, runClip, attackClip, dieClip, scale,
    baseY: -bbox.min.y, centerXZ: { x: center.x, z: center.z },
  };
  console.log(`[tribrute] template loaded: scale=${scale.toFixed(2)} idle="${idleClip?.name}" run="${runClip?.name}" attack="${attackClip?.name}" die="${dieClip?.name}"`);
}

function spawnTribrute(dir: THREE.Vector3, worldId: WorldId = 'third'): void {
  if (!tribruteTemplate) return;
  if (tribrutesSpawnedTotal >= TRIBRUTE_LIFETIME_TOTAL) return;
  const groundMesh = worldGroundMesh(worldId);
  if (!groundMesh) return;
  const tpl = tribruteTemplate;
  const centre = new THREE.Vector3();
  worldGravityCentre(worldId, centre);
  // Surface point on the chosen asteroid in given direction.
  const ro = centre.clone().addScaledVector(dir, asteroidBoundingRadius * 2.5);
  asteroidRaycaster.set(ro, dir.clone().negate());
  asteroidRaycaster.far = asteroidBoundingRadius * 5;
  const hits = asteroidRaycaster.intersectObject(groundMesh, true);
  if (!hits[0]) return;
  const surfPoint = hits[0].point.clone();

  const inst = cloneSkeleton(tpl.root) as THREE.Object3D;
  inst.position.set(-tpl.centerXZ.x, tpl.baseY, -tpl.centerXZ.z);
  const wrap = new THREE.Group();
  wrap.add(inst);
  wrap.scale.setScalar(tpl.scale);
  const up = surfPoint.clone().sub(centre).normalize();
  wrap.position.copy(surfPoint);
  wrap.up.copy(up);
  wrap.traverse(c => { c.visible = true; c.frustumCulled = false; });
  relaxSkinnedRaycastBounds(wrap);
  const bodyAnchor = findBodyAnchor(inst);
  scene.add(wrap);

  const mixer = new THREE.AnimationMixer(inst);
  const mkAction = (clip: THREE.AnimationClip | null) => clip ? mixer.clipAction(clip) : null;
  const idleAction   = mkAction(tpl.idleClip);
  const runAction    = mkAction(tpl.runClip);
  const attackAction = mkAction(tpl.attackClip);
  const dieAction    = mkAction(tpl.dieClip);
  if (idleAction) {
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.time = Math.random() * (tpl.idleClip?.duration ?? 1);
    idleAction.play();
  }

  const { sprite: hpBar, canvas: hpBarCanvas, texture: hpBarTexture } = makeHpBar();
  scene.add(hpBar);

  tribrutes.push({
    group: wrap, mixer,
    idleAction, runAction, attackAction, dieAction,
    state: 'idle',
    attackCooldown: 0,
    dyingTimer: 0,
    position: surfPoint,
    worldId,
    hp: TRIBRUTE_MAX_HP,
    maxHp: TRIBRUTE_MAX_HP,
    alive: true,
    hpBar, hpBarCanvas, hpBarTexture, hpRatioDrawn: 1,
    bodyAnchor,
  });
  tribrutesSpawnedTotal++;
}

function setTribruteState(t: Tribrute, state: Tribrute['state']): void {
  if (t.state === state) return;
  t.state = state;
  // Fade everything out, then fade in the relevant action.
  for (const a of [t.idleAction, t.runAction, t.attackAction, t.dieAction]) {
    if (a) a.fadeOut(0.15);
  }
  let chosen: THREE.AnimationAction | null = null;
  let loop: THREE.AnimationActionLoopStyles = THREE.LoopRepeat;
  let clamp = false;
  if      (state === 'idle')   chosen = t.idleAction;
  else if (state === 'run')    chosen = t.runAction;
  else if (state === 'attack') chosen = t.attackAction;
  else if (state === 'dying')  { chosen = t.dieAction; loop = THREE.LoopOnce; clamp = true; }
  if (chosen) {
    chosen.reset().fadeIn(0.1).play();
    chosen.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    chosen.clampWhenFinished = clamp;
  }
}

function tickTribruteSpawner(dt: number): void {
  if (!tribruteTemplate) return;
  const cur = currentWorldId();
  // Tribrutes only live on second/third — no spawning while on first.
  if (cur === 'first') return;
  const groundMesh = worldGroundMesh(cur);
  if (!groundMesh) return;
  tribruteSpawnAccum += dt;
  if (tribruteSpawnAccum < TRIBRUTE_SPAWN_INTERVAL) return;
  tribruteSpawnAccum = 0;

  // Per-world alive cap (so second can host both spiders + tribrutes
  // without becoming a meat grinder).
  const aliveOnThisWorld = tribrutes.reduce((n, t) => (t.alive && t.worldId === cur ? n + 1 : n), 0);
  if (aliveOnThisWorld >= tribruteCapFor(cur)) return;

  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  const centre = new THREE.Vector3();
  worldGravityCentre(cur, centre);
  for (let i = 0; i < 16; i++) {
    const candidate = new THREE.Vector3().randomDirection();
    const ro = centre.clone().addScaledVector(candidate, asteroidBoundingRadius * 2.5);
    asteroidRaycaster.set(ro, candidate.clone().negate());
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(groundMesh, true);
    if (!hits[0]) continue;
    const toSpawn = hits[0].point.clone().sub(player.position).normalize();
    if (toSpawn.dot(camForward) < MONSTER_SPAWN_PLAYER_DOT) {
      spawnTribrute(candidate, cur);
      return;
    }
  }
}

/** Pre-spawn N tribrutes scattered around the given asteroid at boot. */
function prespawnTribrutes(count: number, worldId: WorldId = 'third'): void {
  if (!tribruteTemplate) return;
  const groundMesh = worldGroundMesh(worldId);
  if (!groundMesh) return;
  let placed = 0;
  for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
    const dir = new THREE.Vector3().randomDirection();
    const before = tribrutes.length;
    spawnTribrute(dir, worldId);
    if (tribrutes.length > before) placed++;
  }
  console.log(`[tribrute] prespawn on ${worldId}: ${placed}/${count}`);
}

function spawnInitialTribrutes(count: number): void {
  if (!tribruteTemplate || !farAsteroid) return;
  const farPos = new THREE.Vector3();
  farAsteroid.getWorldPosition(farPos);
  const playerUp = player.position.clone().sub(farPos).normalize();
  let placed = 0;
  for (let attempt = 0; attempt < count * 6 && placed < count; attempt++) {
    const random = new THREE.Vector3().randomDirection();
    const tangent = random.sub(playerUp.clone().multiplyScalar(random.dot(playerUp))).normalize();
    const angle = THREE.MathUtils.degToRad(40 + Math.random() * 110);
    const candidate = playerUp.clone().applyAxisAngle(tangent, angle);
    spawnTribrute(candidate);
    placed++;
  }
  console.log(`[tribrute] initial spawn ${placed}/${count}`);
}

let _tribruteFrame = 0;

function tickTribrutes(dt: number): void {
  const cur = currentWorldId();
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  _tribruteFrame++;
  const _centre = new THREE.Vector3();

  for (let i = tribrutes.length - 1; i >= 0; i--) {
    const t = tribrutes[i];
    const onMyWorld = (t.worldId === cur);

    // Off-world: hide and skip the per-frame tick. Dying-timer still counts
    // down so corpses despawn eventually.
    if (!onMyWorld) {
      t.group.visible = false;
      t.hpBar.visible = false;
      if (t.state === 'dying') {
        t.dyingTimer -= dt;
        if (t.dyingTimer <= 0) despawnTribrute(t, i);
      }
      continue;
    }

    worldGravityCentre(t.worldId, _centre);
    const groundMesh = worldGroundMesh(t.worldId);

    // Animation LOD by distance (same shape as walker LOD).
    const distSq = t.position.distanceToSquared(player.position);
    let mixerDt = dt;
    if (distSq > 30 * 30) mixerDt = (i + _tribruteFrame) % 2 === 0 ? dt * 2 : 0;
    if (mixerDt > 0) t.mixer.update(mixerDt);

    if (t.state === 'dying') {
      t.dyingTimer -= dt;
      if (t.dyingTimer <= 0) despawnTribrute(t, i);
      continue;
    }

    if (!t.alive) continue;

    t.group.visible = true;
    if (t.attackCooldown > 0) t.attackCooldown -= dt;
    const toPlayer = player.position.clone().sub(t.position);
    const dist = Math.sqrt(distSq);

    if (dist <= TRIBRUTE_ATTACK_RANGE) {
      setTribruteState(t, 'attack');
      if (t.attackCooldown <= 0) {
        t.attackCooldown = TRIBRUTE_ATTACK_INTERVAL;
        damagePlayer(1);
      }
    } else if (dist <= TRIBRUTE_AGGRO_RANGE) {
      setTribruteState(t, 'run');
      const up = t.position.clone().sub(_centre).normalize();
      const tangent = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
      if (tangent.lengthSq() > 1e-6) {
        tangent.normalize();
        t.position.addScaledVector(tangent, TRIBRUTE_SPEED * dt);
        // Throttled surface re-clamp (every 4 frames, phase-staggered).
        if (groundMesh && (_tribruteFrame + i) % 4 === 0) {
          const newUp = t.position.clone().sub(_centre).normalize();
          const ro = _centre.clone().addScaledVector(newUp, asteroidBoundingRadius * 2.5);
          asteroidRaycaster.set(ro, newUp.clone().negate());
          asteroidRaycaster.far = asteroidBoundingRadius * 5;
          const hits = asteroidRaycaster.intersectObject(groundMesh, true);
          if (hits[0]) t.position.copy(hits[0].point);
        }
      }
    } else {
      // Out of aggro range — stand idle.
      setTribruteState(t, 'idle');
    }

    const stand = t.position.clone().sub(_centre).normalize();
    t.group.position.copy(t.position);
    t.group.up.copy(stand);
    t.group.lookAt(t.position.clone().add(toPlayer));
    tickTribruteHpBar(t, _centre, camPos);
  }
}

function tickTribruteHpBar(t: Tribrute, farPos: THREE.Vector3, camPos: THREE.Vector3): void {
  const ratio = Math.max(0, t.hp / t.maxHp);
  if (Math.abs(ratio - t.hpRatioDrawn) > 0.005) {
    drawHpBar(t.hpBarCanvas, ratio);
    t.hpBarTexture.needsUpdate = true;
    t.hpRatioDrawn = ratio;
  }
  const anchorPos = _scratchAnchor;
  if (t.bodyAnchor) t.bodyAnchor.getWorldPosition(anchorPos);
  else anchorPos.copy(t.position);
  const up = anchorPos.clone().sub(farPos).normalize();
  t.hpBar.position.copy(anchorPos).addScaledVector(up, TRIBRUTE_HEIGHT * 0.35 + 0.3);
  const distToCam = t.hpBar.position.distanceTo(camPos);
  const k = Math.min(1, distToCam / 5);
  t.hpBar.scale.set(HP_BAR_W * k, HP_BAR_H * k, 1);
  t.hpBar.visible = t.alive;
}

function damageTribrute(t: Tribrute, hitPoint: THREE.Vector3, headshot: boolean = false): void {
  if (!t.alive) return;
  t.hp = headshot ? 0 : t.hp - 1;
  if (t.hp > 0) { playHit(); return; }
  t.alive = false;
  if (headshot) playHeadshot(); else playMonsterDie();
  // Headshots use the global headshot reward (15) so head-shooting reads
  // consistently across creature types; whole-body kills use the tribrute reward.
  // Tribrutes are tougher (5 HP) so headshots are worth more XP than the
  // base 15-XP global headshot reward — 1.5× the body-kill payout.
  const reward = headshot ? Math.round(TRIBRUTE_XP_REWARD * 1.5) : TRIBRUTE_XP_REWARD;
  totalXP += reward;
  walkersKilled++;
  if (headshot) {
    headshotKills++;
    spawnHeadshotPopup(hitPoint);
  }
  refreshXpHud();
  spawnXpPopup(hitPoint, reward);
  checkLevelUp();
  maybeDropHpPickup(t.position, t.worldId);
  t.hpBar.visible = false;
  if (t.dieAction) {
    setTribruteState(t, 'dying');
    t.dyingTimer = (t.dieAction.getClip().duration ?? 1) + 0.5;
  } else {
    despawnTribrute(t);
  }
}

function despawnTribrute(t: Tribrute, idxHint?: number): void {
  scene.remove(t.group);
  scene.remove(t.hpBar);
  t.hpBarTexture.dispose();
  (t.hpBar.material as THREE.SpriteMaterial).dispose();
  t.group.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
  const idx = idxHint ?? tribrutes.indexOf(t);
  if (idx >= 0) tribrutes.splice(idx, 1);
}

// --- bats (third-asteroid flying enemies) ---------------------------------

interface BatTemplate {
  root: THREE.Object3D;
  idleClip: THREE.AnimationClip | null;
  flyClip: THREE.AnimationClip | null;       // FastFly
  attackClip: THREE.AnimationClip | null;    // Attack2
  death1Clip: THREE.AnimationClip | null;
  death2Clip: THREE.AnimationClip | null;
  scale: number;
  baseY: number;
  centerXZ: { x: number; z: number };
}

interface Bat {
  group: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | null;
  flyAction: THREE.AnimationAction | null;
  attackAction: THREE.AnimationAction | null;
  dyingAction: THREE.AnimationAction | null;  // bound on death (Death1 or Death2 random)
  state: 'idle' | 'fly' | 'attack' | 'dying';
  fireCooldown: number;
  dyingTimer: number;
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  hpBar: THREE.Sprite;
  hpBarCanvas: HTMLCanvasElement;
  hpBarTexture: THREE.CanvasTexture;
  hpRatioDrawn: number;
  cachedSurfR: number;     // last-known surface radius below the bat (throttled raycast)
  bodyAnchor: THREE.Object3D | null;
}

const BAT_HEIGHT          = 1.4;       // bigger silhouette than the eyebeasts
const BAT_MAX_HP          = 3;         // weapon is full-auto so a quick click already lands 2 — bumping to 3 keeps it from feeling one-shot
const BAT_MAX_ALIVE       = 6;
const BAT_LIFETIME_TOTAL  = 30;
const BAT_SPEED           = 5.5;       // a bit faster than eyebeasts
const BAT_HOVER_DIST      = 9;         // engages closer than first-asteroid fliers
const BAT_HOVER_ALT       = 5;         // and lower over the surface
const BAT_FIRE_RANGE      = 35;
const BAT_FIRE_INTERVAL   = 2.0;
const BAT_XP_REWARD       = 30;
let batsSpawnedTotal = 0;

let batTemplate: BatTemplate | null = null;
const bats: Bat[] = [];
let batSpawnAccum = 0;
let _batFrame = 0;

async function loadBatTemplate(): Promise<void> {
  let gltf;
  try { gltf = await loader.loadAsync(`${MODEL_BASE}bat.glb`); }
  catch (e) { console.warn('[bat] load failed:', e); return; }

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bbox = meshOnlyBbox(root);
  if (bbox.isEmpty()) return;
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const heightAxis = Math.max(size.x, size.y, size.z);
  const scale = BAT_HEIGHT / (heightAxis || 1);

  const find = (re: RegExp) => gltf.animations.find(c => re.test(c.name)) ?? null;
  batTemplate = {
    root, scale,
    baseY: -bbox.min.y, centerXZ: { x: center.x, z: center.z },
    idleClip:   find(/^idle$/i),
    flyClip:    find(/fastfly/i) ?? find(/^fly$/i),
    attackClip: find(/attack2/i) ?? find(/attack/i),
    death1Clip: find(/death1/i) ?? find(/death|die/i),
    death2Clip: find(/death2/i),
  };
  console.log(`[bat] template loaded: scale=${scale.toFixed(2)} idle="${batTemplate.idleClip?.name}" fly="${batTemplate.flyClip?.name}" attack="${batTemplate.attackClip?.name}" death1="${batTemplate.death1Clip?.name}" death2="${batTemplate.death2Clip?.name}"`);
}

function spawnBat(dir: THREE.Vector3): void {
  if (!batTemplate || !farAsteroid) return;
  if (batsSpawnedTotal >= BAT_LIFETIME_TOTAL) return;
  const tpl = batTemplate;
  const farPos = new THREE.Vector3();
  farAsteroid.getWorldPosition(farPos);
  // Surface point on Toutatis in given direction.
  const ro = farPos.clone().addScaledVector(dir, asteroidBoundingRadius * 2.5);
  asteroidRaycaster.set(ro, dir.clone().negate());
  asteroidRaycaster.far = asteroidBoundingRadius * 5;
  const hits = asteroidRaycaster.intersectObject(farAsteroid, true);
  if (!hits[0]) return;
  const surfPoint = hits[0].point.clone();
  // Spawn point: a bit above the surface so they're already airborne.
  const up = surfPoint.clone().sub(farPos).normalize();
  const position = surfPoint.clone().addScaledVector(up, BAT_HOVER_ALT * 1.3);

  const inst = cloneSkeleton(tpl.root) as THREE.Object3D;
  inst.position.set(-tpl.centerXZ.x, tpl.baseY, -tpl.centerXZ.z);
  const wrap = new THREE.Group();
  wrap.add(inst);
  wrap.scale.setScalar(tpl.scale);
  wrap.position.copy(position);
  wrap.up.copy(up);
  wrap.traverse(c => { c.visible = true; c.frustumCulled = false; });
  relaxSkinnedRaycastBounds(wrap);
  const bodyAnchor = findBodyAnchor(inst);
  scene.add(wrap);

  const mixer = new THREE.AnimationMixer(inst);
  const mkAction = (clip: THREE.AnimationClip | null) => clip ? mixer.clipAction(clip) : null;
  const idleAction   = mkAction(tpl.idleClip);
  const flyAction    = mkAction(tpl.flyClip);
  const attackAction = mkAction(tpl.attackClip);
  if (idleAction) {
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.time = Math.random() * (tpl.idleClip?.duration ?? 1);
    idleAction.play();
  }

  const { sprite: hpBar, canvas: hpBarCanvas, texture: hpBarTexture } = makeHpBar();
  scene.add(hpBar);

  bats.push({
    group: wrap, mixer,
    idleAction, flyAction, attackAction,
    dyingAction: null,
    state: 'idle',
    fireCooldown: 1.0 + Math.random() * 1.5,
    dyingTimer: 0,
    position,
    hp: BAT_MAX_HP,
    maxHp: BAT_MAX_HP,
    alive: true,
    hpBar, hpBarCanvas, hpBarTexture, hpRatioDrawn: 1,
    cachedSurfR: surfPoint.distanceTo(farPos),
    bodyAnchor,
  });
  batsSpawnedTotal++;
}

function setBatState(b: Bat, state: Bat['state']): void {
  if (b.state === state) return;
  b.state = state;
  for (const a of [b.idleAction, b.flyAction, b.attackAction, b.dyingAction]) {
    if (a) a.fadeOut(0.15);
  }
  let chosen: THREE.AnimationAction | null = null;
  let loop: THREE.AnimationActionLoopStyles = THREE.LoopRepeat;
  let clamp = false;
  if      (state === 'idle')   chosen = b.idleAction;
  else if (state === 'fly')    chosen = b.flyAction;
  else if (state === 'attack') chosen = b.attackAction;
  else if (state === 'dying')  { chosen = b.dyingAction; loop = THREE.LoopOnce; clamp = true; }
  if (chosen) {
    chosen.reset().fadeIn(0.1).play();
    chosen.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    chosen.clampWhenFinished = clamp;
  }
}

function prespawnBats(count: number): void {
  if (!batTemplate || !farAsteroid) return;
  let placed = 0;
  for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
    const dir = new THREE.Vector3().randomDirection();
    const before = bats.length;
    spawnBat(dir);
    if (bats.length > before) placed++;
  }
  console.log(`[bat] prespawn ${placed}/${count}`);
}

function tickBatSpawner(dt: number): void {
  if (!batTemplate || !farAsteroid) return;
  if (currentWorldId() !== 'third') return;
  batSpawnAccum += dt;
  if (batSpawnAccum < BAT_FIRE_INTERVAL * 1.5) return;
  batSpawnAccum = 0;

  const aliveCount = bats.reduce((n, b) => b.alive ? n + 1 : n, 0);
  if (aliveCount >= BAT_MAX_ALIVE) return;

  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  const farPos = new THREE.Vector3();
  farAsteroid.getWorldPosition(farPos);
  for (let i = 0; i < 16; i++) {
    const candidate = new THREE.Vector3().randomDirection();
    const ro = farPos.clone().addScaledVector(candidate, asteroidBoundingRadius * 2.5);
    asteroidRaycaster.set(ro, candidate.clone().negate());
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(farAsteroid, true);
    if (!hits[0]) continue;
    const toSpawn = hits[0].point.clone().sub(player.position).normalize();
    if (toSpawn.dot(camForward) < MONSTER_SPAWN_PLAYER_DOT) {
      spawnBat(candidate);
      return;
    }
  }
}

function tickBats(dt: number): void {
  if (!farAsteroid) return;
  const onThird = currentWorldId() === 'third';
  if (!onThird) {
    for (let i = bats.length - 1; i >= 0; i--) {
      const b = bats[i];
      b.group.visible = false;
      b.hpBar.visible = false;
      if (b.state === 'dying') {
        b.dyingTimer -= dt;
        if (b.dyingTimer <= 0) despawnBat(b, i);
      }
    }
    return;
  }
  const farPos = new THREE.Vector3();
  farAsteroid.getWorldPosition(farPos);
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  _batFrame++;

  for (let i = bats.length - 1; i >= 0; i--) {
    const b = bats[i];

    // Animation LOD by distance.
    const distSq = b.position.distanceToSquared(player.position);
    let mixerDt = dt;
    if (distSq > 30 * 30) mixerDt = (i + _batFrame) % 2 === 0 ? dt * 2 : 0;
    if (mixerDt > 0) b.mixer.update(mixerDt);

    if (b.state === 'dying') {
      b.dyingTimer -= dt;
      if (b.dyingTimer <= 0) despawnBat(b, i);
      continue;
    }

    if (!b.alive) continue;

    b.group.visible = true;
    b.fireCooldown -= dt;

    const up = b.position.clone().sub(farPos).normalize();
    // Surface radius below the bat — refreshed every 6 frames per bat
    // (phase-staggered) instead of every frame. The bat moves slowly enough
    // that a 6-frame stale surface radius is invisible visually, and we
    // skip 5 raycasts vs 11k-tri Toutatis per bat per frame.
    if ((_batFrame + i) % 6 === 0) {
      const ro = farPos.clone().addScaledVector(up, asteroidBoundingRadius * 2.5);
      asteroidRaycaster.set(ro, up.clone().negate());
      asteroidRaycaster.far = asteroidBoundingRadius * 5;
      const h = asteroidRaycaster.intersectObject(farAsteroid, true);
      if (h[0]) b.cachedSurfR = h[0].point.distanceTo(farPos);
    }
    const altitude = b.position.distanceTo(farPos) - b.cachedSurfR;

    const toPlayer = player.position.clone().sub(b.position);
    const dist = Math.sqrt(distSq);

    // Move tangentially to maintain hover distance from the player.
    const tangentToPlayer = toPlayer.clone().sub(up.clone().multiplyScalar(toPlayer.dot(up)));
    const tangentDist = tangentToPlayer.length();
    if (tangentDist > 1e-3) tangentToPlayer.divideScalar(tangentDist);

    if (tangentDist > BAT_HOVER_DIST + 1) {
      b.position.addScaledVector(tangentToPlayer, BAT_SPEED * dt);
    } else if (tangentDist < BAT_HOVER_DIST - 1) {
      b.position.addScaledVector(tangentToPlayer, -BAT_SPEED * dt * 0.5);
    }

    // Vertical: settle to BAT_HOVER_ALT above the surface.
    const altErr = altitude - BAT_HOVER_ALT;
    if (Math.abs(altErr) > 0.3) {
      b.position.addScaledVector(up, -Math.sign(altErr) * BAT_SPEED * 0.6 * dt);
    }
    b.position.addScaledVector(up, Math.sin(performance.now() * 0.003 + b.fireCooldown) * 0.025);

    // Attack vs fly state.
    if (dist < BAT_FIRE_RANGE && b.fireCooldown <= 0) {
      setBatState(b, 'attack');
      fireProjectile(b.position.clone(), player.position.clone());
      b.fireCooldown = BAT_FIRE_INTERVAL;
    } else {
      setBatState(b, 'fly');
    }

    b.group.position.copy(b.position);
    b.group.up.copy(up);
    b.group.lookAt(player.position);
    tickBatHpBar(b, farPos, camPos);
  }
}

function tickBatHpBar(b: Bat, farPos: THREE.Vector3, camPos: THREE.Vector3): void {
  const ratio = Math.max(0, b.hp / b.maxHp);
  if (Math.abs(ratio - b.hpRatioDrawn) > 0.005) {
    drawHpBar(b.hpBarCanvas, ratio);
    b.hpBarTexture.needsUpdate = true;
    b.hpRatioDrawn = ratio;
  }
  const anchorPos = _scratchAnchor;
  if (b.bodyAnchor) b.bodyAnchor.getWorldPosition(anchorPos);
  else anchorPos.copy(b.position);
  const up = anchorPos.clone().sub(farPos).normalize();
  b.hpBar.position.copy(anchorPos).addScaledVector(up, BAT_HEIGHT * 0.6 + 0.3);
  const distToCam = b.hpBar.position.distanceTo(camPos);
  const k = Math.min(1, distToCam / 5);
  b.hpBar.scale.set(HP_BAR_W * k, HP_BAR_H * k, 1);
  b.hpBar.visible = b.alive;
}

function damageBat(b: Bat, hitPoint: THREE.Vector3): void {
  if (!b.alive) return;
  b.hp -= 1;
  if (b.hp > 0) { playHit(); return; }
  b.alive = false;
  playMonsterDie();
  totalXP += BAT_XP_REWARD;
  fliersKilled++;
  refreshXpHud();
  spawnXpPopup(hitPoint, BAT_XP_REWARD);
  checkLevelUp();
  // Drop pickup at a surface point under the bat (so it's reachable).
  if (farAsteroid) {
    const farPos = new THREE.Vector3();
    farAsteroid.getWorldPosition(farPos);
    const upDir = b.position.clone().sub(farPos).normalize();
    const ro = farPos.clone().addScaledVector(upDir, asteroidBoundingRadius * 2.5);
    asteroidRaycaster.set(ro, upDir.clone().negate());
    asteroidRaycaster.far = asteroidBoundingRadius * 5;
    const hits = asteroidRaycaster.intersectObject(farAsteroid, true);
    const dropPos = hits[0]?.point.clone() ?? b.position;
    maybeDropHpPickup(dropPos, 'third');
  } else {
    maybeDropHpPickup(b.position, 'third');
  }
  // Random pick between Death1 and Death2.
  const tpl = batTemplate;
  const dieClips = [tpl?.death1Clip, tpl?.death2Clip].filter(Boolean) as THREE.AnimationClip[];
  const dieClip = dieClips.length ? dieClips[Math.floor(Math.random() * dieClips.length)] : null;
  if (dieClip) {
    b.dyingAction = b.mixer.clipAction(dieClip);
    setBatState(b, 'dying');
    b.dyingTimer = dieClip.duration + 0.3;
  } else {
    despawnBat(b);
  }
  b.hpBar.visible = false;
}

function despawnBat(b: Bat, idxHint?: number): void {
  scene.remove(b.group);
  scene.remove(b.hpBar);
  b.hpBarTexture.dispose();
  (b.hpBar.material as THREE.SpriteMaterial).dispose();
  b.group.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
  const idx = idxHint ?? bats.indexOf(b);
  if (idx >= 0) bats.splice(idx, 1);
}

function shatterSpider(s: Spider, hitPoint: THREE.Vector3): void {
  s.group.updateMatrixWorld(true);

  type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mat: THREE.Material };
  const tris: Tri[] = [];

  s.group.traverse(c => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const m2w = mesh.matrixWorld;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    // Stride into the mesh so we don't burn time emitting 67k tris just to
    // throw 99% of them away.
    const stride = Math.max(1, Math.floor(triCount / FRAG_MAX_PER_SHATTER));
    for (let t = 0; t < triCount; t += stride) {
      const ai = idx ? idx.getX(t * 3)     : t * 3;
      const bi = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ci = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, ai).applyMatrix4(m2w);
      const b = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(m2w);
      const c2 = new THREE.Vector3().fromBufferAttribute(pos, ci).applyMatrix4(m2w);
      tris.push({ a, b, c: c2, mat });
      if (tris.length >= FRAG_MAX_PER_SHATTER) break;
    }
  });

  // Remove the spider + its HP bar from the scene.
  scene.remove(s.group);
  scene.remove(s.hpBar);
  s.hpBarTexture.dispose();
  (s.hpBar.material as THREE.SpriteMaterial).dispose();
  s.group.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
  const idx = spiders.indexOf(s);
  if (idx >= 0) spiders.splice(idx, 1);

  for (const { a, b, c, mat } of tris) {
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
      transparent: true, opacity: 1,
      flatShading: true,
    });
    const fragMesh = new THREE.Mesh(fragGeom, fragMat);
    fragMesh.position.copy(center);
    const outward = center.clone().sub(hitPoint);
    const dlen = outward.length() || 0.0001;
    outward.divideScalar(dlen);
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

/**
 * Three.js's SkinnedMesh.raycast caches `boundingSphere` on the mesh on
 * first raycast call (computed from current animation pose) — and never
 * recomputes. Animations that drift further from that pose later become
 * "unkillable" because the broad-phase rejects the now-out-of-sphere mesh.
 *
 * Fix: invalidate each alive creature's boundingSphere at the start of
 * every fire raycast (called once per shot). Three.js then recomputes from
 * the current animation pose on the next intersect call. Cost: one
 * vertex-iter pass per shot per alive creature — not per frame — so it's
 * cheap, and the bounds are always tight to the rendered mesh.
 */
function invalidateSkinnedRaycastBounds(root: THREE.Object3D): void {
  root.traverse(c => {
    const sm = c as THREE.SkinnedMesh;
    if (!(sm as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    // @types/three's defs say boundingSphere/Box must be non-null but the
    // runtime treats null as "recompute on next raycast" — that's exactly
    // what we want here, so cast through the type system.
    sm.boundingSphere = null as unknown as THREE.Sphere;
    sm.boundingBox = null as unknown as THREE.Box3;
  });
}

// Kept under the old name as a no-op so existing callers still type-check
// while the new invalidate-on-fire flow takes over.
function relaxSkinnedRaycastBounds(_root: THREE.Object3D, _mult: number = 0): void { /* no-op */ }

/** Reusable scratch for anchor world-position reads. */
const _scratchAnchor = new THREE.Vector3();

/** Find a roughly-central body bone in a skinned hierarchy. Used to anchor
 *  HP bars to the actual rendered position of an animated creature
 *  (otherwise the bar floats at the rig's translation origin while the
 *  visible mesh has slid away due to animation root-motion). */
function findBodyAnchor(root: THREE.Object3D): THREE.Object3D | null {
  let named: THREE.Object3D | null = null;
  let smesh: THREE.SkinnedMesh | null = null;
  root.traverse(c => {
    if ((c as { isBone?: boolean }).isBone && !named) {
      if (/spine|hip|pelvis|body|chest|abdomen|torso/i.test(c.name)) named = c;
    }
    if ((c as { isSkinnedMesh?: boolean }).isSkinnedMesh && !smesh) {
      smesh = c as THREE.SkinnedMesh;
    }
  });
  if (named) return named;
  if (smesh) {
    const bones = (smesh as THREE.SkinnedMesh).skeleton.bones;
    if (bones.length) return bones[Math.floor(bones.length / 2)] ?? null;
  }
  return null;
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
  relaxSkinnedRaycastBounds(wrap);
  const bodyAnchor = findBodyAnchor(inst);

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
    bodyAnchor,
  });
}

async function spawnInitialMonsters(): Promise<void> {
  if (monsterTemplate) {
    let placed = 0, attempts = 0;
    while (placed < MONSTER_INITIAL && attempts < MONSTER_INITIAL * 4) {
      attempts++;
      const dir = new THREE.Vector3().randomDirection();
      const surf = asteroidSurfacePoint(dir);
      if (!surf) continue;
      spawnMonster(dir, 'walker');
      walkersSpawned++;
      placed++;
    }
    console.log(`[monster] initial walker spawn ${placed}/${MONSTER_INITIAL}`);
  }
  if (flierTemplate) {
    let placed = 0, attempts = 0;
    while (placed < FLIER_INITIAL && attempts < FLIER_INITIAL * 6) {
      attempts++;
      const dir = new THREE.Vector3().randomDirection();
      const surf = asteroidSurfacePoint(dir);
      if (!surf) continue;
      spawnMonster(dir, 'flier');
      fliersSpawned++;
      placed++;
    }
    console.log(`[monster] initial flier spawn ${placed}/${FLIER_INITIAL}`);
  }
}

/**
 * Trickle-spawn new monsters over time up to MONSTER_MAX_ALIVE. Random
 * direction, but rejected if it would pop in front of the player. Mix of
 * walkers and fliers controlled by FLIER_SPAWN_FRACTION.
 */
let spawnAccumulator = 0;
function tickMonsterSpawner(dt: number): void {
  if (!monsterTemplate && !flierTemplate) return;
  // Pause spawning while the player is off the first asteroid — the
  // spawner places monsters on the first asteroid, where the player isn't.
  if (currentWorldId() !== 'first') return;
  spawnAccumulator += dt;
  if (spawnAccumulator < MONSTER_SPAWN_INTERVAL) return;
  spawnAccumulator = 0;

  // Per-kind alive caps drive the eligible set; the run quota
  // (TARGET_WALKERS/TARGET_FLIERS) still gates the lifetime totals.
  let aliveWalkers = 0, aliveFliers = 0;
  for (const m of monsters) {
    if (!m.alive) continue;
    if (m.kind === 'flier') aliveFliers++; else aliveWalkers++;
  }
  const walkerSlotFree = aliveWalkers < MAX_ALIVE_WALKERS && walkersSpawned < TARGET_WALKERS;
  const flierSlotFree  = aliveFliers  < MAX_ALIVE_FLIERS  && !!flierTemplate && fliersSpawned < TARGET_FLIERS;
  if (!walkerSlotFree && !flierSlotFree) return;

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

  let wantFlier: boolean;
  if (walkerSlotFree && flierSlotFree) {
    wantFlier = Math.random() < FLIER_SPAWN_FRACTION;
  } else {
    wantFlier = flierSlotFree; // only kind whose slot is free
  }

  if (wantFlier) {
    spawnMonster(dir, 'flier');
    fliersSpawned++;
  } else {
    spawnMonster(dir, 'walker');
    walkersSpawned++;
  }
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
  // Cache camera world position once per frame so per-monster tickHpBar
  // doesn't allocate a Vector3 each call (50 monsters → 50 fewer allocs).
  camera.getWorldPosition(_scratchCam);
  _camPosFrame++;
  // When the player isn't on the first asteroid, hide every monster and
  // skip mixer updates entirely. Saves the GPU skinning cost for ~12+
  // skinned meshes that would otherwise just be visually frozen.
  const onFirst = currentWorldId() === 'first';
  if (!onFirst) {
    for (let i = monsters.length - 1; i >= 0; i--) {
      const m = monsters[i];
      m.group.visible = false;
      m.hpBar.visible = false;
      if (m.state === 'dying') {
        m.dyingTimer -= dt;
        if (m.dyingTimer <= 0) despawnMonster(m, i);
      }
    }
    return;
  }
  for (let i = monsters.length - 1; i >= 0; i--) {
    const m = monsters[i];
    m.group.visible = true;
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
  // While the player is on a different asteroid, walkers (which all live on
  // the first) shouldn't pursue or attack — leave them idle in place.
  if (currentWorldId() !== 'first') {
    setMonsterState(m, 'walking');
    const stand = m.position.clone().normalize();
    m.group.position.copy(m.position);
    m.group.up.copy(stand);
    return;
  }

  const toPlayer = player.position.clone().sub(m.position);
  const dist = toPlayer.length();

  if (m.attackCooldown > 0) m.attackCooldown -= dt;

  if (dist <= ATTACK_RANGE) {
    setMonsterState(m, 'attacking');
    if (m.attackCooldown <= 0) {
      m.attackCooldown = ATTACK_INTERVAL;
      damagePlayer(1);
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
  // Same gate as the walker: when the player is off the first asteroid,
  // fliers should hover idle and not fire.
  if (currentWorldId() !== 'first') {
    const up = m.position.clone().normalize();
    m.group.position.copy(m.position);
    m.group.up.copy(up);
    return;
  }

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

// Module-level scratch — reused inside per-monster ticks to avoid 50-100
// Vector3 allocations every frame.
const _scratchUp = new THREE.Vector3();
const _scratchCam = new THREE.Vector3();
let _camPosFrame = -1; // updated by tickMonsters before calling per-monster ticks

function tickHpBar(m: Monster): void {
  const ratio = Math.max(0, m.hp / m.maxHp);
  if (Math.abs(ratio - m.hpRatioDrawn) > 0.005) {
    drawHpBar(m.hpBarCanvas, ratio);
    m.hpBarTexture.needsUpdate = true;
    m.hpRatioDrawn = ratio;
  }
  // Anchor on the rig's body bone so the bar tracks animation translation
  // (eyebeasts hover-anim drifts the rendered mesh from wrap.position).
  const anchorPos = _scratchAnchor;
  if (m.bodyAnchor) m.bodyAnchor.getWorldPosition(anchorPos);
  else anchorPos.copy(m.position);
  // position the bar above the creature. Eyebeasts (kind='flier') sit with
  // the body-bone in the dead centre of the eye, so we lift further; walkers
  // get a smaller lift (the body bone is already near hip level).
  _scratchUp.copy(anchorPos).normalize();
  const offset = m.kind === 'flier' ? 1.3 : 1.2;
  m.hpBar.position.copy(anchorPos).addScaledVector(_scratchUp, offset);
  // Distance to camera (camera world position cached by tickMonsters).
  const dist = m.hpBar.position.distanceTo(_scratchCam);
  // Below 5m, shrink linearly so it doesn't dominate the view; above stays
  // at full size (already small at distance).
  const k = Math.min(1, dist / 5);
  m.hpBar.scale.set(HP_BAR_W * k, HP_BAR_H * k, 1);
  // hide once dead/dying
  m.hpBar.visible = m.alive;
}

// --- weapon (FPS rig glb with arms + animations) --------------------------

type WeaponPrimary = 'drawing' | 'idle' | 'running' | 'firing' | 'reloading' | 'inspecting';

interface WeaponState {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  // Clip slots (any may be null if the glb didn't include that motion).
  drawAction:    THREE.AnimationAction | null;
  idleAction:    THREE.AnimationAction | null;
  runAction:     THREE.AnimationAction | null;
  fireAction:    THREE.AnimationAction | null;
  reloadAction:  THREE.AnimationAction | null;
  inspectAction: THREE.AnimationAction | null;
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

  // We need the rifle's IDLE-pose centre (not the bind-pose bbox centre) as
  // the centering anchor — otherwise scaling drags the rifle on screen
  // because the skinning offset between bind and idle is multiplied by scale.
  // To get idle-pose vertex world positions we'll set up animations now,
  // play idle for a moment, then sample.

  // Pull animations forward — we need them for the temp mixer below.
  const clips = gltf.animations;

  // Locate the rifle SkinnedMesh.
  let rifleMesh: THREE.SkinnedMesh | null = null;
  inner.traverse(c => {
    if (rifleMesh) return;
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const matName = (m.material as { name?: string } | null)?.name ?? '';
    if (/rifle|main_|vector|akm|m4/i.test(`${m.name} ${matName}`)) {
      if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
        rifleMesh = m as unknown as THREE.SkinnedMesh;
      } else if (!rifleMesh) {
        // fall back to the regular mesh — applyBoneTransform won't work but
        // bbox-centre is at least better than the whole-rig centre.
      }
    }
  });

  // Pre-roll idle animation for one frame so applyBoneTransform reads the
  // animated pose. Mixer is created here briefly; the real one is set up
  // again below so the actual game's animation timing isn't affected.
  let anchor = center.clone();
  if (rifleMesh) {
    const rm = rifleMesh as THREE.SkinnedMesh;
    const idleClipTmp = clips.find(c => /idle|rest/i.test(c.name)) ?? clips[0];
    if (idleClipTmp) {
      const tmpMixer = new THREE.AnimationMixer(inner);
      const tmpAction = tmpMixer.clipAction(idleClipTmp);
      tmpAction.play();
      tmpMixer.update(0.4); // settle into idle
      inner.updateMatrixWorld(true);

      // Sample the bbox-centre of the rifle in skinned (idle) pose.
      if (!rm.geometry.boundingBox) rm.geometry.computeBoundingBox();
      const b = rm.geometry.boundingBox;
      if (b) {
        // Average a handful of vertices in the rifle to estimate the
        // rendered centre after skinning.
        const pos = rm.geometry.attributes.position as THREE.BufferAttribute;
        const n = Math.min(64, pos.count);
        const acc = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          const idx = Math.floor((i / n) * pos.count);
          tmp.fromBufferAttribute(pos, idx);
          rm.applyBoneTransform(idx, tmp);
          tmp.applyMatrix4(rm.matrixWorld);
          acc.add(tmp);
        }
        anchor.copy(acc.divideScalar(n));
      }
      tmpMixer.stopAllAction();
    }
  }
  inner.position.set(-anchor.x, -anchor.y, -anchor.z);

  const wrap = new THREE.Group();
  wrap.add(inner);

  // Hand-tuned default. With the idle-pose-corrected anchor, scale and
  // position are decoupled — these stay roughly correct at any scale.
  wrap.scale.setScalar(2.2690);
  wrap.rotation.set(0, Math.PI, 0);
  wrap.position.set(0.180, -0.340, -0.950);
  wrap.traverse(c => {
    // Hide any Line/LineSegments — defensive.
    const asLine = c as THREE.Line;
    if (asLine.isLine || (c as THREE.LineSegments).isLineSegments) {
      c.visible = false;
      return;
    }
    c.visible = true;
    c.frustumCulled = false;
    // Disable any morph-target influences — could be the source of artefacts.
    const meshAny = c as THREE.Mesh & { morphTargetInfluences?: number[] };
    if (meshAny.isMesh && meshAny.morphTargetInfluences) {
      for (let i = 0; i < meshAny.morphTargetInfluences.length; i++) {
        meshAny.morphTargetInfluences[i] = 0;
      }
    }

    // GEOMETRY-LEVEL outlier fix — works on every Mesh, skinned or not.
    // The "thin red lines" coming off the scope are triangles whose vertices
    // are at extreme positions in the static mesh geometry; they aren't
    // animated artifacts. Snap any vertex more than 15× the median radius
    // from the mesh centroid back onto the centroid (degenerate, invisible).
    const meshGeom = c as THREE.Mesh;
    if (meshGeom.isMesh && meshGeom.geometry) {
      const pos = meshGeom.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (pos) {
        let mx = 0, my = 0, mz = 0;
        for (let i = 0; i < pos.count; i++) { mx += pos.getX(i); my += pos.getY(i); mz += pos.getZ(i); }
        mx /= pos.count; my /= pos.count; mz /= pos.count;
        const dists = new Array<number>(pos.count);
        for (let i = 0; i < pos.count; i++) {
          dists[i] = Math.hypot(pos.getX(i) - mx, pos.getY(i) - my, pos.getZ(i) - mz);
        }
        const sorted = [...dists].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 1;
        const threshold = Math.max(10, median * 15);
        let fixed = 0;
        for (let i = 0; i < dists.length; i++) {
          if (dists[i] > threshold) {
            pos.setXYZ(i, mx, my, mz);
            fixed++;
          }
        }
        if (fixed > 0) {
          pos.needsUpdate = true;
          meshGeom.geometry.computeBoundingBox();
          meshGeom.geometry.computeBoundingSphere();
          console.log(`[weapon] geom-fixed ${fixed} outlier verts on "${meshGeom.name}" (median=${median.toFixed(2)})`);
        }
      }
    }

    // The model's author noted "rifle has glitchy vertices". Two passes:
    //   1. Normalise broken skin weights (sum != 1).
    //   2. Sample post-skin position; vertices whose skinned position lands
    //      ridiculously far from the cluster median get rebound to bone 0
    //      with weight 1 so they stop drawing lines into the sky.
    const sm = c as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.geometry) return;
    const skinIndex = sm.geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
    const skinWeight = sm.geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
    const posAttr = sm.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!skinIndex || !skinWeight || !posAttr) return;

    let fixed = 0;
    // Pass 1: normalise weights.
    for (let i = 0; i < skinWeight.count; i++) {
      const w = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i);
      if (!(w >= 0.99 && w <= 1.01)) {
        skinWeight.setXYZW(i, 1, 0, 0, 0);
        skinIndex.setXYZW(i, 0, 0, 0, 0);
        fixed++;
      }
    }

    // Pass 2: outlier detection in skinned space.
    // Sample every vertex's post-skin position, find outliers via robust
    // (median-of-coordinates) centroid so a few extreme vertices don't
    // skew the centroid back onto themselves.
    const sx: number[] = [], sy: number[] = [], sz: number[] = [];
    const samples: THREE.Vector3[] = new Array(posAttr.count);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr, i);
      sm.applyBoneTransform(i, tmp);
      samples[i] = tmp.clone();
      sx.push(tmp.x); sy.push(tmp.y); sz.push(tmp.z);
    }
    const med = (a: number[]) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
    const cx = med([...sx]), cy = med([...sy]), cz = med([...sz]);
    const dists = samples.map(s => Math.hypot(s.x - cx, s.y - cy, s.z - cz));
    const distsSorted = [...dists].sort((a, b) => a - b);
    const medianDist = distsSorted[Math.floor(distsSorted.length / 2)] || 1;
    const threshold = Math.max(0.5, medianDist * 5);

    // Mark outlier vertex indices.
    const outliers = new Set<number>();
    for (let i = 0; i < dists.length; i++) {
      if (dists[i] > threshold) outliers.add(i);
    }

    // Pass 3: degenerate triangles touching any outlier — collapse all 3
    // indices to the first one so the triangle has zero area and is
    // effectively invisible. This is THE fix for the "thin lines" — moving
    // the vertex via skin weights wasn't enough because the triangles still
    // stretched from the moved vertex to its neighbours.
    let degenerated = 0;
    const idx = sm.geometry.index;
    if (idx && outliers.size > 0) {
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t);
        const b = idx.getX(t + 1);
        const c = idx.getX(t + 2);
        if (outliers.has(a) || outliers.has(b) || outliers.has(c)) {
          idx.setX(t, a);
          idx.setX(t + 1, a);
          idx.setX(t + 2, a);
          degenerated++;
        }
      }
      if (degenerated > 0) idx.needsUpdate = true;
    }

    if (fixed > 0 || degenerated > 0) {
      skinIndex.needsUpdate = true;
      skinWeight.needsUpdate = true;
      console.log(`[weapon] "${sm.name}": ${fixed} bad-weight verts + ${outliers.size} outlier verts → ${degenerated} triangles degenerated (median dist=${medianDist.toFixed(3)}, threshold=${threshold.toFixed(2)})`);
    }
  });
  camera.add(wrap);

  // ---- mesh-toggle debug: keys 1..N hide/show each rifle mesh ----
  // Find the meshes (excluding hidden Line/LineSegments) for inspection.
  const debugMeshes: THREE.Mesh[] = [];
  wrap.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.visible) debugMeshes.push(m);
  });
  console.log('[weapon] toggle meshes via Digit keys:');
  debugMeshes.forEach((m, i) => {
    const matName = (m.material as { name?: string } | null)?.name ?? '?';
    console.log(`  [${i + 1}] "${m.name}" mat="${matName}"`);
  });
  window.addEventListener('keydown', (e) => {
    if (!e.code.startsWith('Digit')) return;
    const idx = parseInt(e.code.slice(5)) - 1;
    if (idx >= 0 && idx < debugMeshes.length) {
      const m = debugMeshes[idx];
      m.visible = !m.visible;
      console.log(`[toggle] "${m.name}" → ${m.visible ? 'visible' : 'HIDDEN'}`);
    }
  });

  // (weapon-position live-tune hotkeys removed — see ring-tune block below.)

  // animations (clips already pulled above for the idle-anchor sampler)
  const mixer = clips.length > 0 ? new THREE.AnimationMixer(inner) : null;

  // Pick clips by name. The Cransh pack uses "Arms_FPS_Anim_<Action>" naming
  // — names like "Arms_FPS_Anim_Idle" lowercase are "arms_fps_anim_idle", so
  // \bidle\b doesn't match (the underscore is a word char, no boundary).
  // Just substring-match. Exclude "OneShot" from the fire pick — user wants
  // the looping "Shoot" for sustained fire.
  const findClip = (re: RegExp, exclude?: RegExp) =>
    clips.find(c => re.test(c.name.toLowerCase()) && !(exclude && exclude.test(c.name.toLowerCase()))) ?? null;

  const drawClip    = findClip(/draw/);
  const idleClip    = findClip(/idle|rest/) ?? (clips.length === 1 ? clips[0] : null);
  const runClip     = findClip(/run|sprint/);
  const fireClip    = findClip(/shoot|fire/, /oneshot|aim/);
  const reloadClip  = findClip(/reload/);
  const inspectClip = findClip(/inspect/);

  const makeAction = (clip: THREE.AnimationClip | null, loop: boolean): THREE.AnimationAction | null => {
    if (!mixer || !clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = false;
    return a;
  };

  // Shoot LOOPS — every clip iteration is one shot. User asked for this so
  // sustained fire shows continuous animation rather than re-triggering.
  const drawAction    = makeAction(drawClip,    false);
  const idleAction    = makeAction(idleClip,    true);
  const runAction     = makeAction(runClip,     true);
  const fireAction    = makeAction(fireClip,    true);
  const reloadAction  = makeAction(reloadClip,  false);
  const inspectAction = makeAction(inspectClip, false);

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
    drawAction, idleAction, runAction, fireAction, reloadAction, inspectAction,
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
    case 'drawing':    action = w.drawAction;    break;
    case 'idle':       action = w.idleAction;    break;
    case 'running':    action = w.runAction ?? w.idleAction; break;
    case 'firing':     action = w.fireAction;    break;
    case 'reloading':  action = w.reloadAction;  break;
    case 'inspecting': action = w.inspectAction; break;
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
  const oneShot = primary === 'drawing' || primary === 'reloading' || primary === 'inspecting';
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
  playShoot();

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
  for (const m of monsters)  if (m.alive) targets.push(m.group);
  for (const s of spiders)   if (s.alive) targets.push(s.group);
  for (const t of tribrutes) if (t.alive) targets.push(t.group);
  for (const b of bats)      if (b.alive) targets.push(b.group);

  // Three.js caches SkinnedMesh.boundingSphere on first raycast; later
  // animation poses can drift outside it and the broad-phase silently
  // rejects subsequent rays — that's the "shoot at a creature, no damage"
  // bug. Invalidate the cached bounds right before the ray test so three.js
  // re-derives them from the current animated pose.
  //
  // Pre-filter: only invalidate creatures plausibly in line of fire
  // (within range AND within ~60° of the crosshair). Without this filter
  // sustained full-auto fire (10 shots/sec) would re-iterate every spider's
  // 67k bone-transformed vertices, which lags the game noticeably.
  const _fireFrom = new THREE.Vector3();
  camera.getWorldPosition(_fireFrom);
  const _fireDir = new THREE.Vector3();
  camera.getWorldDirection(_fireDir);
  const _toTarget = new THREE.Vector3();
  const FIRE_RANGE_SQ = FIRE_RANGE * FIRE_RANGE;
  for (const t of targets) {
    if (t === rockInstanced) continue;  // rocks aren't skinned
    t.getWorldPosition(_toTarget);
    _toTarget.sub(_fireFrom);
    const dSq = _toTarget.lengthSq();
    if (dSq > FIRE_RANGE_SQ * 1.2) continue;
    if (dSq > 4) {                      // skip the dot test for very near targets
      _toTarget.divideScalar(Math.sqrt(dSq));
      if (_toTarget.dot(_fireDir) < 0.5) continue;
    }
    invalidateSkinnedRaycastBounds(t);
  }

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
    const spider = spiders.find(x => x.group === node);
    if (spider) {
      damageSpider(spider, hit.point);
      return;
    }
    const bat = bats.find(x => x.group === node);
    if (bat) {
      damageBat(bat, hit.point);
      return;
    }
    const tribrute = tribrutes.find(x => x.group === node);
    if (tribrute) {
      // Headshot: top ~22% of the tribrute's height along its local up
      // (= direction from its world centre to its feet).
      const centre = new THREE.Vector3();
      worldGravityCentre(tribrute.worldId, centre);
      const up = tribrute.position.clone().sub(centre).normalize();
      const heightAlongUp = hit.point.clone().sub(tribrute.position).dot(up);
      const headshot = heightAlongUp > TRIBRUTE_HEIGHT * 0.78;
      damageTribrute(tribrute, hit.point, headshot);
      return;
    }
    const m = monsters.find(x => x.group === node);
    if (m) {
      // Headshot: walker hit in the top ~22% of its height (along its local
      // up = direction from asteroid centre) → instant kill.
      let headshot = false;
      if (m.kind === 'walker') {
        const up = m.position.clone().normalize();
        const heightAlongUp = hit.point.clone().sub(m.position).dot(up);
        if (heightAlongUp > MONSTER_HEIGHT * 0.78) headshot = true;
      }
      damageMonster(m, hit.point, headshot);
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
function damageMonster(m: Monster, hitPoint: THREE.Vector3, headshot: boolean = false): void {
  if (!m.alive) return;
  m.hp = headshot ? 0 : m.hp - 1;
  if (m.hp > 0) { playHit(); return; }

  m.alive = false;
  if (headshot) spawnHeadshotPopup(hitPoint);
  awardXp(m, hitPoint, headshot);

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

// Toggleable per-frame ground-clamp log. Press `L` in-game to flip.
// While on, every tickPlayer call dumps the inputs/outputs of the surface
// raycast & clamp so we can post-mortem any judder by reading the console.
let _debugClampLog = false;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyL') return;
  _debugClampLog = !_debugClampLog;
  console.log(`[clamp] log ${_debugClampLog ? 'ON' : 'OFF'}`);
});

// Continuous tangent-basis construction via parallel transport. The simple
// "ref = (0,0,1) unless |up.z| > T" approach (with or without hysteresis)
// snaps when the player walks through the band where up.z crosses the
// threshold — every threshold-based selector eventually flips and inverts
// the basis, jolting the camera.
//
// Instead we cache the previous frame's t1 in world space and, each frame,
// project it onto the plane perpendicular to the new up. Because the
// projection of any unit vector that's nearly perpendicular changes
// smoothly with the basis, t1 evolves continuously — no flips, no jitter.
const _persistentT1 = new THREE.Vector3(1, 0, 0);
function buildStableTangent(eyeUp: THREE.Vector3, t1Out: THREE.Vector3): void {
  const dot = _persistentT1.dot(eyeUp);
  t1Out.copy(_persistentT1).addScaledVector(eyeUp, -dot);
  if (t1Out.lengthSq() < 0.01) {
    // Cached t1 has drifted parallel to up — re-seed from a world axis
    // that's roughly perpendicular to up.
    if (Math.abs(eyeUp.x) < 0.9)      t1Out.set(1, 0, 0);
    else if (Math.abs(eyeUp.y) < 0.9) t1Out.set(0, 1, 0);
    else                              t1Out.set(0, 0, 1);
    t1Out.addScaledVector(eyeUp, -t1Out.dot(eyeUp));
  }
  t1Out.normalize();
  _persistentT1.copy(t1Out);
}

function tickPlayer(dt: number): void {
  // Pick the gravity centre and the mesh used for ground raycasts based on
  // which asteroid the player is standing on (origin / decor / Toutatis).
  const gravityCentre = new THREE.Vector3();
  worldGravityCentre(currentWorldId(), gravityCentre);
  const groundMesh = worldGroundMesh(currentWorldId());

  // Use position-relative-to-centre as "up" — works for roughly-spherical bodies.
  const rel = player.position.clone().sub(gravityCentre);
  const up = rel.lengthSq() > 0.01 ? rel.normalize() : new THREE.Vector3(0, 1, 0);

  const t1 = new THREE.Vector3();
  buildStableTangent(up, t1);
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

  // ground contact: exact raycast against the active body's mesh.
  const ground = currentWorldId() === 'first'
    ? findGroundExact(player.position)
    : (groundMesh ? findGroundOnObject(player.position, gravityCentre, groundMesh) : null);
  // Debug snapshot — written even if `ground` was null so we can see when
  // the raycast misses entirely.
  const _dbgUp = ground ? ground.up : new THREE.Vector3();
  const _dbg = _debugClampLog ? {
    w: currentWorldId(),
    pPre: player.position.toArray().map(n => +n.toFixed(3)),
    vPre: player.velocity.toArray().map(n => +n.toFixed(3)),
    pR: +player.position.distanceTo(gravityCentre).toFixed(3),
    g: ground ? +ground.point.distanceTo(gravityCentre).toFixed(3) : null,
    grounded: player.grounded,
    moving,
    yaw: +player.yaw.toFixed(3),
    pitch: +player.pitch.toFixed(3),
    up: _dbgUp.toArray().map(n => +n.toFixed(3)),
    keysW: keys.has('KeyW'),
  } : null;
  if (ground) {
    const playerR = player.position.distanceTo(gravityCentre);
    const surfR = ground.point.distanceTo(gravityCentre);
    const footR = surfR + PLAYER_RADIUS;
    if (playerR < footR) {
      // Cap upward correction per frame so an irregular-asteroid raycast
      // glitch (catching a different lobe of Toutatis when WASD shifts the
      // up direction slightly) can't teleport the camera several metres up
      // in one tick. The next frame's raycast will resolve toward the real
      // surface and gravity does the rest.
      const targetR = Math.min(footR, playerR + 1.5);
      player.position.copy(gravityCentre).addScaledVector(ground.up, targetR);
      const inward = player.velocity.dot(ground.up);
      if (inward < 0) player.velocity.addScaledVector(ground.up, -inward);
      player.grounded = (targetR >= footR - 0.01);
      if (_dbg) Object.assign(_dbg, { surfR: +surfR.toFixed(2), footR: +footR.toFixed(2), targetR: +targetR.toFixed(2), capped: targetR < footR - 0.001 });
    } else if (playerR > footR + 0.05) {
      player.grounded = false;
      if (_dbg) Object.assign(_dbg, { surfR: +surfR.toFixed(2), footR: +footR.toFixed(2), aboveSurface: +(playerR - footR).toFixed(2) });
    } else if (_dbg) {
      Object.assign(_dbg, { surfR: +surfR.toFixed(2), footR: +footR.toFixed(2), restingOnSurface: true });
    }
  }
  if (_dbg) console.log('[clamp]', JSON.stringify(_dbg));

  if (player.grounded && moving) player.bobPhase += dt * (speed === SPRINT_SPEED ? 11 : 8);
  const bob = Math.sin(player.bobPhase) * (player.grounded && moving ? 0.04 : 0);

  const eyeUp = player.position.clone().sub(gravityCentre).normalize();
  camera.position.copy(player.position).addScaledVector(eyeUp, EYE_HEIGHT - PLAYER_RADIUS + bob);
  camera.up.copy(eyeUp);

  // Cache for any external code (e.g. mirror field jump-back) that wants
  // the current "up" while on the second asteroid.
  if (onSecondAsteroid) secondAsteroidUp.copy(eyeUp);

  const t1b = new THREE.Vector3();
  buildStableTangent(eyeUp, t1b);
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
  } else if (weapon.primary === 'inspecting' && weapon.primaryTimer > 0) {
    desired = 'inspecting';
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
    const used = all.filter(c => ['asteroid', 'rock', 'fps_rifle', 'monster', 'projectile', 'spider', 'asteroid_far', 'tribrute', 'bat'].includes(c.slug));
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
  // Pause the simulation while the player has pointer-lock released
  // (Esc → menu overlay) — but keep rendering so the overlay re-draws.
  if (!paused()) {
  // Wrap the per-frame work in try/catch so a single transient error doesn't
  // halt the loop (which previously caused pointer lock release & a "kicked
  // back to menu" feel).
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!tickJump(dt)) tickPlayer(dt);   // arc jump overrides player movement
    tickMonsterSpawner(dt);
    tickMonsters(dt);
    tickSpiderSpawner(dt);
    tickSpiders(dt);
    tickTribruteSpawner(dt);
    tickTribrutes(dt);
    tickBatSpawner(dt);
    tickBats(dt);
    tickHpPickups(dt);
    tickEyebeasts(dt);
    tickProjectiles(dt);
    tickXpPopups(dt);
    tickDecorAsteroid(dt);
    tickJumpField();
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

  } catch (e) {
    console.error('[animate]', e);
  }
  } else {
    // While paused, drain the clock so the first frame after un-pause
    // doesn't get a huge dt that teleports everything.
    clock.getDelta();
  }
  // Always render so the menu overlay stays interactive.
  renderer.render(scene, camera);
}

/** True while the user has Esc'd out of the game (menu overlay visible).
 *  We keep rAF running for the menu but skip simulation/AI ticks. */
let bootCompleted = false;
function paused(): boolean {
  if (!bootCompleted) return false;
  if (playerDead)    return false;          // death overlay handles its own UX
  return document.pointerLockElement !== renderer.domElement;
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
  const STEPS = 13;
  let i = 0;
  renderCredits();
  await step('loading asteroid',          STEPS, ++i, loadAsteroid);
  await step('sampling surface',          STEPS, ++i, () => buildSurfaceTable());
  player.position.set(0, asteroidBoundingRadius * 1.2, 0);
  await step('scattering rocks',          STEPS, ++i, loadAndScatterRocks);
  await step('loading creatures',         STEPS, ++i, loadMonsterTemplate);
  await step('spawning monsters',         STEPS, ++i, spawnInitialMonsters);
  await step('loading weapon',            STEPS, ++i, loadWeapon);
  await step('loading skydome',           STEPS, ++i, loadSkydome);
  await step('loading projectiles',       STEPS, ++i, loadProjectileTemplate);
  // Eyebeasts disabled — were ambient hovering on second asteroid but the
  // user found them more confusing than atmospheric. Loader/spawner code
  // is kept so they can be re-enabled by uncommenting.
  // await step('eyebeasts',              STEPS, ++i, async () => { await loadEyebeastTemplate(); spawnEyebeasts(); });
  await step('loading spiders',           STEPS, ++i, async () => { await loadSpiderTemplate(); prespawnSpiders(6); });
  await step('placing far asteroid',      STEPS, ++i, loadFarAsteroid);
  await step('loading tribrutes',         STEPS, ++i, async () => {
    await loadTribruteTemplate();
    // Mix 6 yellow tribrutes onto the second asteroid alongside the spiders,
    // and the full 12 on the third asteroid.
    prespawnTribrutes(6, 'second');
    prespawnTribrutes(12, 'third');
  });
  await step('loading bats',              STEPS, ++i, async () => {
    await loadBatTemplate();
    prespawnBats(4);
  });
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
  bootCompleted = true;
  animate();
})();
