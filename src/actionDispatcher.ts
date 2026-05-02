/**
 * Client action dispatcher.
 *
 * Single-player flow:
 *   input handler → dispatch(action) → applyAction(action) → events emitted
 *   → microtask drains buffer → eventApplier runs side-effects (DOM, Three.js)
 *
 * Future multiplayer flow (Stage C):
 *   input handler → dispatch(action) → network.send({ action })
 *   → server validates + applies → broadcasts events → eventApplier runs them
 *
 * This module hides whether dispatch is local-synchronous or remote-async
 * from the input layer.
 */

import type { Action } from './shared/actions.ts';
import { applyAction } from './shared/reducer.ts';

/**
 * Dispatch a player action.
 *
 * In Stage A this calls the local reducer synchronously. The events the
 * reducer returns are already drained from the buffer; nothing else needs
 * to consume them because the buffer is also auto-flushed via setEventSink
 * (see src/eventApplier.ts).
 *
 * Returns true if the action was accepted, false on rejection (e.g. action
 * not yet wired through the reducer).
 */
export function dispatch(action: Action): boolean {
  const result = applyAction(action);
  if (!result.ok) {
    console.warn('[actionDispatcher]', result.error);
    return false;
  }
  return true;
}
