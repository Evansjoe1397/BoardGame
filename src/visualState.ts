import * as THREE from 'three';
import type { UnitVisual, BuildingVisual, PlayerId } from './types';

export interface ActiveEffect {
  duration: number;
  elapsed: number;
  update(effect: ActiveEffect, delta: number): void;
  complete?(): void;
}

export interface MovementAnimation {
  start: THREE.Vector3;
  end: THREE.Vector3;
  elapsed: number;
  duration: number;
  stepCount: number;
  prevX: number;
  prevZ: number;
}

export const boardGroup: THREE.Group = new THREE.Group();
export const effectsGroup: THREE.Group = new THREE.Group();
export const squareMeshesByKey: Map<string, THREE.Mesh> = new Map();
export const clickableMeshes: THREE.Mesh[] = [];
export const unitVisualsById: Map<string, UnitVisual> = new Map();
export const buildingVisualsById: Map<string, BuildingVisual> = new Map();
export const baseMeshesByPlayer: Map<PlayerId, THREE.Mesh[]> = new Map();
export const movementAnimations: Map<string, MovementAnimation> = new Map();
export const unitStatusBadgeTextureCache: Map<string, THREE.CanvasTexture> = new Map();
export const activeEffects: ActiveEffect[] = [];
export const clock: THREE.Clock = new THREE.Clock();

let _moveRangeBorderLines: THREE.LineSegments | null = null;
export function getMoveRangeBorderLines(): THREE.LineSegments | null { return _moveRangeBorderLines; }
export function setMoveRangeBorderLines(val: THREE.LineSegments | null): void { _moveRangeBorderLines = val; }
