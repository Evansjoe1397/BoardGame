/**
 * Game lifecycle events: base destruction, end of game, etc.
 */

import type { EventHandler } from '../shared/events.ts';

export const lifecycleEventHandlers = {
  BASE_DESTROYED: ((_e) => {
    // The game-state mutation (player.baseDestroyed = true) and the visual
    // teardown of base meshes still happen inside engine/combat.ts:destroyBase.
    // This handler exists as the named-event marker; once destroyBase is
    // refactored to emit BASE_DESTROYED *as the* trigger for those side
    // effects, the mutation+teardown will move here.
  }) satisfies EventHandler<'BASE_DESTROYED'>,
};
