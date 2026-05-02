/**
 * Unit lifecycle / state events.
 *
 * Drives the walk animation on movement; future events here will mutate
 * unit-state granularly (UNIT_DAMAGED → set hp+shield, play hit), avoiding
 * full snapshot replacement.
 */

import type { EventHandler } from '../shared/events.ts';
import { startUnitMoveAnimation } from '../three/animation.ts';

export const unitEventHandlers = {
  UNIT_MOVED: ((e) => {
    startUnitMoveAnimation(e.unitId, e.fromX, e.fromZ, e.toX, e.toZ);
  }) satisfies EventHandler<'UNIT_MOVED'>,
};
