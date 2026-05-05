/**
 * Building lifecycle event handlers.
 */

import type { EventHandler } from '../shared/events.ts';
import type { Player } from '../types.ts';
import { state } from '../state.ts';
import { buildingVisualsById, boardGroup } from '../visualState.ts';
import { createBuildingVisual } from '../three/buildingVisuals.ts';
import { fromSquareKey } from '../utils.ts';
import { gridToWorld } from '../three/coords.ts';

function findBuildingOwner(buildingId: string): Player | null {
  for (const playerId of ['A', 'B'] as const) {
    const player = state.players[playerId];
    if (player.buildings.find((b) => b.id === buildingId)) return player;
  }
  return null;
}

export const buildingEventHandlers = {
  BUILDING_PLACED: ((e) => {
    const owner = state.players[e.building.owner];
    if (!owner.buildings.find((b) => b.id === e.building.id)) {
      owner.buildings.push(e.building);
    }
    let visual = buildingVisualsById.get(e.building.id);
    if (!visual) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visual = createBuildingVisual(e.building as any) as any;
      if (visual) {
        boardGroup.add(visual.root);
        buildingVisualsById.set(e.building.id, visual);
      }
    }
    if (visual) {
      const sq = fromSquareKey(e.building.squareKey);
      const wp = gridToWorld(sq.x, sq.z);
      visual.root.position.set(wp.x, 0, wp.z);
    }
  }) satisfies EventHandler<'BUILDING_PLACED'>,

  BUILDING_UPGRADED: ((e) => {
    const owner = findBuildingOwner(e.buildingId);
    if (!owner) return;
    const building = owner.buildings.find((b) => b.id === e.buildingId);
    if (!building) return;
    building.upgraded = e.upgraded;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    building.upgradeStatusIds = e.upgradeStatusIds as any;
  }) satisfies EventHandler<'BUILDING_UPGRADED'>,

  BUILDING_DESTROYED: ((e) => {
    for (const playerId of ['A', 'B'] as const) {
      const player = state.players[playerId];
      const idx = player.buildings.findIndex((b) => b.id === e.buildingId);
      if (idx >= 0) {
        player.buildings.splice(idx, 1);
        break;
      }
    }
    const visual = buildingVisualsById.get(e.buildingId);
    if (visual) {
      boardGroup.remove(visual.root);
      buildingVisualsById.delete(e.buildingId);
    }
  }) satisfies EventHandler<'BUILDING_DESTROYED'>,
};
