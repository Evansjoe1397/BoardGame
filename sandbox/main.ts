/**
 * Asteroid FPS sandbox.
 *
 * - Spherical planet with gravity pointing toward its center.
 * - First-person controls: WASD relative to local "up" (away from planet).
 * - Mouse look (pointer-lock).
 * - LMB fires a raycast pistol; hit objects shatter into individual triangles.
 *
 * Loads .glb assets that were downloaded by sandbox/scripts/fetch-models.ts
 * into /sandbox/models/. Self-contained — does not import from src/.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- constants -------------------------------------------------------------

const PLANET_RADIUS = 28;
const GRAVITY = 18;            // m/s^2, toward planet center
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;     // for ground contact tolerance
const WALK_SPEED = 6;
const SPRINT_SPEED = 10;
const JUMP_SPEED = 7.5;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

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
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050816);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 800);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- starfield -------------------------------------------------------------

{
  const starGeom = new THREE.BufferGeometry();
  const N = 1500;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ).normalize().multiplyScalar(400 + Math.random() * 50);
    arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
  }
  starGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const stars = new THREE.Points(
    starGeom,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }),
  );
  scene.add(stars);
}

// --- lighting --------------------------------------------------------------

scene.add(new THREE.AmbientLight(0x6a7896, 0.55));

const sun = new THREE.DirectionalLight(0xfff1c8, 1.4);
sun.position.set(80, 100, 60);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x88aaff, 0x303020, 0.25));

// --- planet ----------------------------------------------------------------

const planetGeom = new THREE.IcosahedronGeometry(PLANET_RADIUS, 6);
{
  // mild noise displacement to break the perfect sphere
  const pos = planetGeom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 0.4) * Math.cos(v.y * 0.4) * Math.sin(v.z * 0.4);
    v.normalize().multiplyScalar(PLANET_RADIUS + n * 0.6);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  planetGeom.computeVertexNormals();
}
const planet = new THREE.Mesh(
  planetGeom,
  new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.9, metalness: 0.0, flatShading: true }),
);
scene.add(planet);

// --- shatterable target registry -------------------------------------------

interface Shatterable {
  group: THREE.Group;
  meshes: THREE.Mesh[];
}

const shatterables: Shatterable[] = [];
const fragments: Fragment[] = [];

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
}

// --- glb loading & placement ----------------------------------------------

const loader = new GLTFLoader();

interface ModelPlacement {
  slug: string;
  count: number;       // how many copies to scatter
  targetSize: number;  // approximate world-size (height)
  yOffset?: number;    // extra lift along local up
}

const PLACEMENTS: ModelPlacement[] = [
  { slug: 'tree',     count: 6, targetSize: 4.0 },
  { slug: 'rock',     count: 7, targetSize: 1.4 },
  { slug: 'mushroom', count: 8, targetSize: 1.2 },
  { slug: 'crate',    count: 3, targetSize: 1.0 },
  { slug: 'barrel',   count: 4, targetSize: 1.4 },
  { slug: 'fox',      count: 2, targetSize: 1.0 },
];

interface CreditsEntry {
  slug: string;
  name: string;
  author: string;
  license: string;
  source: string;
}

async function loadCredits(): Promise<CreditsEntry[]> {
  try {
    const res = await fetch(`${MODEL_BASE}CREDITS.json`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function placeOnSphere(group: THREE.Object3D, dir: THREE.Vector3, surfaceY: number): void {
  // Position so the group's bottom rests on the sphere surface, with its local +Y aligned to `dir`.
  const p = dir.clone().normalize().multiplyScalar(surfaceY);
  group.position.copy(p);
  // rotate so local up = dir
  const up = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  group.quaternion.copy(q);
  // random spin around up
  group.rotateY(Math.random() * Math.PI * 2);
}

async function loadAndPlace(slug: string, p: ModelPlacement): Promise<void> {
  const url = `${MODEL_BASE}${slug}.glb`;
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (e) {
    console.warn(`[load] missing ${slug}:`, e);
    return;
  }
  const template = gltf.scene;

  // Compute bounding box and uniform scale to targetSize.
  const bbox = new THREE.Box3().setFromObject(template);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = p.targetSize / maxDim;
  template.scale.setScalar(scale);
  template.updateMatrixWorld(true);

  // Recompute bbox after scaling so we can offset the group so its base sits at y=0 locally.
  const bbox2 = new THREE.Box3().setFromObject(template);
  const baseOffset = -bbox2.min.y;

  for (let i = 0; i < p.count; i++) {
    const group = new THREE.Group();
    group.name = slug;
    const inst = template.clone(true);
    // make materials unique per instance so we can fade fragments without affecting siblings
    inst.traverse((child) => {
      const m = (child as THREE.Mesh).material;
      if (m) {
        if (Array.isArray(m)) {
          (child as THREE.Mesh).material = m.map(x => x.clone());
        } else {
          (child as THREE.Mesh).material = (m as THREE.Material).clone();
        }
      }
    });
    inst.position.y = baseOffset;
    group.add(inst);

    const dir = new THREE.Vector3().randomDirection();
    placeOnSphere(group, dir, PLANET_RADIUS + (p.yOffset ?? 0));
    scene.add(group);

    const meshes: THREE.Mesh[] = [];
    inst.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
    if (meshes.length > 0) {
      shatterables.push({ group, meshes });
    }
  }
}

async function loadAll(credits: CreditsEntry[]): Promise<void> {
  await Promise.all(PLACEMENTS.map(p => loadAndPlace(p.slug, p)));

  // Render credits panel
  if (credits.length) {
    const lines = credits.map(c =>
      `<b>${escapeHtml(c.name)}</b> · ${escapeHtml(c.author)} · ${escapeHtml(c.license)} · <a href="${escapeAttr(c.source)}" target="_blank" rel="noopener">link</a>`,
    );
    creditsEl.innerHTML = `Models from Sketchfab:<br/>${lines.join('<br/>')}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

// --- player ----------------------------------------------------------------

interface Player {
  position: THREE.Vector3;       // feet position
  velocity: THREE.Vector3;       // world-space velocity
  yaw: number;                   // rotation around local up, radians
  pitch: number;                 // camera pitch, radians (clamped)
  grounded: boolean;
}

const player: Player = {
  position: new THREE.Vector3(0, PLANET_RADIUS, 0), // start at north pole
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: true,
};

const keys = new Set<string>();

window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup',   (e) => keys.delete(e.code));

// pointer lock
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  } else {
    fire();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlayEl.style.display = locked ? 'none' : 'grid';
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw   -= e.movementX * MOUSE_SENS;
  player.pitch -= e.movementY * MOUSE_SENS;
  if (player.pitch >  PITCH_LIMIT) player.pitch =  PITCH_LIMIT;
  if (player.pitch < -PITCH_LIMIT) player.pitch = -PITCH_LIMIT;
});

startBtn.addEventListener('click', () => renderer.domElement.requestPointerLock());

// --- pistol viewmodel ------------------------------------------------------

const pistol = (() => {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.10, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.7 }),
  );
  body.position.set(0, -0.02, 0);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.12, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1a1f29, roughness: 0.8 }),
  );
  grip.position.set(0, -0.10, 0.05);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.3, metalness: 0.9 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.16);

  g.add(body, grip, barrel);
  g.position.set(0.18, -0.18, -0.42);
  camera.add(g);

  // store muzzle world-anchor offset for muzzle flash
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.24);
  g.add(muzzle);

  return { group: g, muzzle, recoil: 0 };
})();

scene.add(camera); // need camera in scene so children render

// muzzle flash sprite
const flashTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0,    'rgba(255,240,180,1)');
  grad.addColorStop(0.4,  'rgba(255,170,60,0.7)');
  grad.addColorStop(1,    'rgba(255,80,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
flashSprite.scale.set(0.4, 0.4, 0.4);
flashSprite.visible = false;
pistol.group.add(flashSprite);
flashSprite.position.copy(pistol.muzzle.position);

let flashTime = 0;

// --- shooting --------------------------------------------------------------

const raycaster = new THREE.Raycaster();
raycaster.far = 200;

function fire(): void {
  // recoil + flash
  pistol.recoil = 0.06;
  flashSprite.visible = true;
  flashTime = 0.06;
  flashSprite.scale.setScalar(0.3 + Math.random() * 0.2);
  flashSprite.material.rotation = Math.random() * Math.PI;

  // raycast from camera forward
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  raycaster.set(origin, dir);

  // gather all meshes from all shatterables
  const allMeshes: THREE.Mesh[] = [];
  for (const s of shatterables) allMeshes.push(...s.meshes);
  if (allMeshes.length === 0) return;

  const hits = raycaster.intersectObjects(allMeshes, false);
  if (hits.length === 0) return;
  const hit = hits[0];

  const target = shatterables.find(s => s.meshes.includes(hit.object as THREE.Mesh));
  if (!target) return;

  shatter(target, hit.point);
}

const FRAG_LIFE = 2.6;
const FRAG_FADE = 0.6;
const FRAG_MAX_PER_SHATTER = 600;

function shatter(target: Shatterable, hitPoint: THREE.Vector3): void {
  // collect triangles in world space across all meshes in the target group
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

  // remove the original
  scene.remove(target.group);
  const idx = shatterables.indexOf(target);
  if (idx >= 0) shatterables.splice(idx, 1);

  // sub-sample if too many triangles
  const step = Math.max(1, Math.ceil(tris.length / FRAG_MAX_PER_SHATTER));

  for (let i = 0; i < tris.length; i += step) {
    const { a, b, c, mat } = tris[i];
    const center = a.clone().add(b).add(c).divideScalar(3);

    // build a tiny geom centered at origin
    const fragGeom = new THREE.BufferGeometry();
    fragGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x - center.x, a.y - center.y, a.z - center.z,
      b.x - center.x, b.y - center.y, b.z - center.z,
      c.x - center.x, c.y - center.y, c.z - center.z,
    ], 3));
    fragGeom.computeVertexNormals();

    // Use a uniform-color material derived from the source so fragments are visible
    // even if the original was textured. Cheap & robust.
    const srcMat = mat as THREE.MeshStandardMaterial;
    const fragMat = new THREE.MeshStandardMaterial({
      color: (srcMat.color ? srcMat.color.clone() : new THREE.Color(0x888888)),
      roughness: srcMat.roughness ?? 0.7,
      metalness: srcMat.metalness ?? 0.1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      flatShading: true,
    });

    const fragMesh = new THREE.Mesh(fragGeom, fragMat);
    fragMesh.position.copy(center);

    // velocity: from hit point outward + random
    const outward = center.clone().sub(hitPoint);
    const dist = outward.length() || 0.0001;
    outward.divideScalar(dist);
    const speed = 4 + Math.random() * 6 + Math.max(0, 4 - dist) * 2;
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

function updateFragments(dt: number): void {
  for (let i = fragments.length - 1; i >= 0; i--) {
    const f = fragments[i];
    f.life += dt;
    // gravity toward planet center
    const toCenter = f.mesh.position.clone().normalize().multiplyScalar(-1);
    f.velocity.addScaledVector(toCenter, GRAVITY * dt);
    f.mesh.position.addScaledVector(f.velocity, dt);
    f.mesh.rotation.x += f.angVel.x * dt;
    f.mesh.rotation.y += f.angVel.y * dt;
    f.mesh.rotation.z += f.angVel.z * dt;

    // crude bounce on planet surface
    const r = f.mesh.position.length();
    if (r < PLANET_RADIUS + 0.05) {
      const n = f.mesh.position.clone().normalize();
      const vDotN = f.velocity.dot(n);
      if (vDotN < 0) {
        f.velocity.addScaledVector(n, -1.6 * vDotN);
        f.velocity.multiplyScalar(0.4);
        f.angVel.multiplyScalar(0.6);
      }
      f.mesh.position.copy(n.multiplyScalar(PLANET_RADIUS + 0.05));
    }

    // fade in last FRAG_FADE seconds
    const remaining = f.maxLife - f.life;
    if (remaining < FRAG_FADE) {
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, remaining / FRAG_FADE);
    }

    if (f.life >= f.maxLife) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
      fragments.splice(i, 1);
    }
  }
}

// --- spherical FPS controls ------------------------------------------------

function tickPlayer(dt: number): void {
  const up = player.position.clone().normalize();

  // build forward (tangent) from yaw
  // pick a stable reference direction not parallel to up
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(ref.dot(up)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
  // tangent basis: t1 = perpendicular component of ref relative to up; t2 = up × t1
  const t1 = ref.clone().sub(up.clone().multiplyScalar(ref.dot(up))).normalize();
  const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

  // forward direction in tangent plane
  const cosY = Math.cos(player.yaw);
  const sinY = Math.sin(player.yaw);
  const forward = t1.clone().multiplyScalar(cosY).addScaledVector(t2, sinY);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  // input
  let mvX = 0, mvZ = 0;
  if (keys.has('KeyW')) mvZ += 1;
  if (keys.has('KeyS')) mvZ -= 1;
  if (keys.has('KeyD')) mvX += 1;
  if (keys.has('KeyA')) mvX -= 1;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;

  const wishDir = forward.clone().multiplyScalar(mvZ).addScaledVector(right, mvX);
  if (wishDir.lengthSq() > 0) wishDir.normalize();

  // separate velocity into vertical (along up) and horizontal (tangent)
  const vUp = player.velocity.dot(up);
  const vTang = player.velocity.clone().addScaledVector(up, -vUp);

  // accelerate horizontally
  const wishSpeed = wishDir.lengthSq() ? speed : 0;
  const targetTang = wishDir.multiplyScalar(wishSpeed);
  vTang.lerp(targetTang, 1 - Math.exp(-12 * dt));

  // gravity
  let vUpNew = vUp - GRAVITY * dt;

  // jump
  if (keys.has('Space') && player.grounded) {
    vUpNew = JUMP_SPEED;
    player.grounded = false;
  }

  player.velocity.copy(vTang).addScaledVector(up, vUpNew);
  player.position.addScaledVector(player.velocity, dt);

  // ground contact: clamp to planet surface + foot offset
  const r = player.position.length();
  const footR = PLANET_RADIUS + PLAYER_RADIUS;
  if (r < footR) {
    // reposition to surface
    player.position.copy(player.position.clone().normalize().multiplyScalar(footR));
    // remove inward velocity component
    const newUp = player.position.clone().normalize();
    const inward = player.velocity.dot(newUp);
    if (inward < 0) player.velocity.addScaledVector(newUp, -inward);
    player.grounded = true;
  } else if (r > footR + 0.05) {
    player.grounded = false;
  }

  // place camera at eye height along up
  const eyeUp = player.position.clone().normalize();
  camera.position.copy(player.position).addScaledVector(eyeUp, EYE_HEIGHT - PLAYER_RADIUS);
  camera.up.copy(eyeUp);

  // recompute forward after position changed (up may have changed direction slightly)
  let ref2 = new THREE.Vector3(0, 0, 1);
  if (Math.abs(ref2.dot(eyeUp)) > 0.95) ref2 = new THREE.Vector3(1, 0, 0);
  const t1b = ref2.clone().sub(eyeUp.clone().multiplyScalar(ref2.dot(eyeUp))).normalize();
  const t2b = new THREE.Vector3().crossVectors(eyeUp, t1b).normalize();
  const forwardNow = t1b.clone().multiplyScalar(Math.cos(player.yaw))
    .addScaledVector(t2b, Math.sin(player.yaw));
  const rightNow = new THREE.Vector3().crossVectors(forwardNow, eyeUp).normalize();
  // apply pitch
  const lookDir = forwardNow.clone().applyAxisAngle(rightNow, player.pitch);
  camera.lookAt(camera.position.clone().add(lookDir));

  // pistol recoil decay
  if (pistol.recoil > 0) {
    pistol.group.position.z = -0.42 + pistol.recoil;
    pistol.recoil = Math.max(0, pistol.recoil - dt * 0.4);
  } else {
    pistol.group.position.z = -0.42;
  }
}

// --- main loop -------------------------------------------------------------

const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  tickPlayer(dt);
  updateFragments(dt);

  if (flashTime > 0) {
    flashTime -= dt;
    if (flashTime <= 0) flashSprite.visible = false;
  }

  infoEl.textContent = `targets: ${shatterables.length}  ·  fragments: ${fragments.length}  ·  altitude: ${(player.position.length() - PLANET_RADIUS).toFixed(2)}`;

  renderer.render(scene, camera);
}

// --- bootstrap -------------------------------------------------------------

(async () => {
  const credits = await loadCredits();
  await loadAll(credits);
  animate();
})();
