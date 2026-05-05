/**
 * Grid → world coordinate conversion. Lives here so importing `utils.ts`
 * from engine code (which is run on the Bun server and in unit tests)
 * doesn't transitively pull in Three.js. Only Three-aware modules import
 * from here.
 */

import * as THREE from 'three';
import { BOARD_WIDTH, BOARD_LENGTH, TILE_SIZE } from '../constants.ts';

export function gridToWorld(x: number, z: number): THREE.Vector3 {
  const worldX = (x - (BOARD_WIDTH - 1) / 2) * TILE_SIZE;
  const worldZ = (z - (BOARD_LENGTH - 1) / 2) * TILE_SIZE;
  return new THREE.Vector3(worldX, 0, worldZ);
}
