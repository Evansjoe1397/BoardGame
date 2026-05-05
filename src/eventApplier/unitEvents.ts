/**
 * Unit lifecycle and state events.
 *
 * Each handler:
 *   - Idempotently mutates the local game state to match the event payload
 *     (so the same code path works on the acting client — where state is
 *     already mutated — and on the receiving client — where it isn't yet).
 *   - Triggers the targeted Three.js / DOM update for the affected unit.
 */

import type { EventHandler } from '../shared/events.ts';
import { state } from '../state.ts';
import { startUnitMoveAnimation } from '../three/animation.ts';
import { unitVisualsById, boardGroup, clickableMeshes } from '../visualState.ts';
import { createUnitVisual } from '../three/unitVisuals.ts';
import { gridToWorld } from '../three/coords.ts';
import { playHitEffect } from '../three/effects.ts';

function findUnit(unitId: string) {
  return state.units.find((u) => u.id === unitId);
}

export const unitEventHandlers = {
  UNIT_MOVED: ((e) => {
    // Update state idempotently (no-op for the acting client, applies the
    // diff for the receiving client).
    const unit = findUnit(e.unitId);
    if (unit) {
      unit.x = e.toX;
      unit.z = e.toZ;
    }
    startUnitMoveAnimation(e.unitId, e.fromX, e.fromZ, e.toX, e.toZ);
  }) satisfies EventHandler<'UNIT_MOVED'>,

  UNIT_SUMMONED: ((e) => {
    if (!findUnit(e.unit.id)) {
      state.units.push(e.unit);
    }
    let visual = unitVisualsById.get(e.unit.id);
    if (!visual) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = createUnitVisual(e.unit) as any;
      if (v) {
        boardGroup.add(v.root);
        clickableMeshes.push(v.clickableMesh);
        unitVisualsById.set(e.unit.id, v);
        visual = v;
      }
    }
    if (visual) {
      const pos = gridToWorld(e.unit.x, e.unit.z);
      visual.root.position.set(pos.x, visual.baseY ?? 0.3, pos.z);
    }
  }) satisfies EventHandler<'UNIT_SUMMONED'>,

  UNIT_DAMAGED: ((e) => {
    const unit = findUnit(e.unitId);
    if (unit) {
      unit.hitPoints = e.newHp;
      unit.shieldHitPoints = e.newShield;
    }
    playHitEffect(e.unitId);
  }) satisfies EventHandler<'UNIT_DAMAGED'>,

  UNIT_HEALED: ((e) => {
    const unit = findUnit(e.unitId);
    if (unit) unit.hitPoints = e.newHp;
  }) satisfies EventHandler<'UNIT_HEALED'>,

  UNIT_SHIELDED: ((e) => {
    const unit = findUnit(e.unitId);
    if (unit) unit.shieldHitPoints = e.newShield;
  }) satisfies EventHandler<'UNIT_SHIELDED'>,

  UNIT_STATUS_APPLIED: ((e) => {
    const unit = findUnit(e.unitId);
    if (!unit) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = unit.grantedStatusIds as any[];
    if (!ids.includes(e.statusId)) ids.push(e.statusId);
  }) satisfies EventHandler<'UNIT_STATUS_APPLIED'>,

  UNIT_STATUS_REMOVED: ((e) => {
    const unit = findUnit(e.unitId);
    if (!unit) return;
    const ids = unit.grantedStatusIds as string[];
    const idx = ids.indexOf(e.statusId);
    if (idx >= 0) ids.splice(idx, 1);
  }) satisfies EventHandler<'UNIT_STATUS_REMOVED'>,

  UNIT_DESTROYED: ((e) => {
    const idx = state.units.findIndex((u) => u.id === e.unitId);
    if (idx >= 0) state.units.splice(idx, 1);
    const visual = unitVisualsById.get(e.unitId);
    if (visual) {
      boardGroup.remove(visual.root);
      const cmIdx = clickableMeshes.indexOf(visual.clickableMesh);
      if (cmIdx >= 0) clickableMeshes.splice(cmIdx, 1);
      unitVisualsById.delete(e.unitId);
    }
  }) satisfies EventHandler<'UNIT_DESTROYED'>,
};
