/**
 * Inspect a glb file: list animation clip names and durations.
 *
 * Usage: bun run sandbox/scripts/inspect-glb.ts <path>
 */

import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) { console.error('usage: inspect-glb <file.glb>'); process.exit(1); }

const buf = await readFile(path);

// glb header: 'glTF', version (4), length (4)
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a glb'); process.exit(1); }

// chunks: [length(4), type(4), data...]
let off = 12;
const jsonLen = buf.readUInt32LE(off); off += 4;
const jsonType = buf.readUInt32LE(off); off += 4;
if (jsonType !== 0x4e4f534a) { console.error('expected JSON chunk'); process.exit(1); }
const jsonStr = buf.subarray(off, off + jsonLen).toString('utf8');
const json = JSON.parse(jsonStr);

// Read the BIN chunk that follows the JSON chunk so we can decode keyframe times.
let binBuf: Buffer | null = null;
{
  const off2 = 12 + 8 + jsonLen;
  if (buf.length > off2 + 8) {
    const len = buf.readUInt32LE(off2);
    const type = buf.readUInt32LE(off2 + 4);
    if (type === 0x004e4942) binBuf = buf.subarray(off2 + 8, off2 + 8 + len) as Buffer;
  }
}

function readMaxFloat(accessor: any): number {
  if (!binBuf) return 0;
  const view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  // Float32 values
  let max = 0;
  for (let i = 0; i < accessor.count; i++) {
    const v = binBuf.readFloatLE(start + i * 4);
    if (v > max) max = v;
  }
  return max;
}

const animations = json.animations ?? [];
console.log(`Animations (${animations.length}):`);
for (const a of animations) {
  let dur = 0;
  for (const s of a.samplers ?? []) {
    const acc = json.accessors[s.input];
    const t = readMaxFloat(acc);
    if (t > dur) dur = t;
  }
  console.log(`  - "${a.name}" channels=${a.channels?.length ?? 0}, duration=${dur.toFixed(2)}s`);
}

const meshes = json.meshes ?? [];
console.log(`\nMeshes (${meshes.length}):`);
for (const m of meshes.slice(0, 10)) {
  console.log(`  - "${m.name}" (primitives: ${m.primitives?.length ?? 0})`);
}

const skins = json.skins ?? [];
console.log(`\nSkins (${skins.length})`);

const cameras = json.cameras ?? [];
console.log(`\nCameras (${cameras.length}):`);
for (const c of cameras) {
  console.log(`  - "${c.name}" type=${c.type}`);
}

// Nodes that reference cameras — these have transforms (where the camera is placed in the scene)
const nodes = json.nodes ?? [];
const cameraNodes = nodes.filter((n: any) => n.camera != null);
console.log(`\nCamera nodes (${cameraNodes.length}):`);
for (const n of cameraNodes) {
  const camName = cameras[n.camera]?.name ?? '?';
  const t = n.translation ? `t=[${n.translation.map((v: number) => v.toFixed(2)).join(',')}]` : '';
  const r = n.rotation ? `r=[${n.rotation.map((v: number) => v.toFixed(3)).join(',')}]` : '';
  console.log(`  - node "${n.name}" → camera "${camName}" ${t} ${r}`);
}

const textures = json.textures ?? [];
const images = json.images ?? [];
const materials = json.materials ?? [];
console.log(`\nTextures: ${textures.length}, Images: ${images.length}, Materials: ${materials.length}`);
for (const m of materials.slice(0, 8)) {
  const pbr = m.pbrMetallicRoughness ?? {};
  const bc = pbr.baseColorTexture != null ? `texture#${pbr.baseColorTexture.index}` : 'no map';
  const color = pbr.baseColorFactor ?? [1,1,1,1];
  console.log(`  - "${m.name}" baseColor=${color.map((v: number)=>v.toFixed(2)).join(',')} ${bc}`);
}
