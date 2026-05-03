import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { boardEl } from '../ui/domSetup.ts';
import { boardGroup, effectsGroup } from '../visualState.ts';

export let camera: THREE.PerspectiveCamera;
export let scene: THREE.Scene;
export let renderer: THREE.WebGLRenderer;
export let controls: OrbitControls;
export let raycaster: THREE.Raycaster;
export let mouse: THREE.Vector2;
export const pressedKeys: Set<string> = new Set();

export function initThree(): void {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10161d);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 42, 38);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  boardEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.0;
  controls.enableZoom = true;
  controls.zoomSpeed = 1.1;
  controls.minDistance = 16;
  controls.maxDistance = 120;
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  // LEFT is reserved for click-selection. While Shift is held we flip it to
  // PAN so users can drag-pan without leaving the left button.
  controls.mouseButtons.LEFT = undefined as unknown as THREE.MOUSE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') controls.mouseButtons.LEFT = undefined as unknown as THREE.MOUSE;
  });
  // If the user releases Shift outside the window (focus loss), reset.
  window.addEventListener('blur', () => {
    controls.mouseButtons.LEFT = undefined as unknown as THREE.MOUSE;
  });

  const ambient = new THREE.AmbientLight(0xffffff, 0.62);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.95);
  directional.position.set(8, 20, 10);
  directional.castShadow = true;
  scene.add(directional);

  scene.add(boardGroup);
  scene.add(effectsGroup);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('contextmenu', (event: Event) => event.preventDefault());

  onResize();
}

export function onResize(): void {
  const width = boardEl.clientWidth;
  const height = boardEl.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
