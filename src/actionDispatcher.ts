/**
 * Client action dispatcher.
 *
 * Multiplayer-only flow:
 *   input handler → dispatch(action) → network.send({ action })
 *   → server validates + applies the reducer → broadcasts events + state snapshot
 *   → client eventApplier runs side-effects (DOM, Three.js)
 *
 * The local reducer is no longer reachable from this entry point — every
 * action goes through the server. If the socket isn't connected the dispatch
 * is dropped (logged in console). Reconnect logic is owned by the network
 * module; nothing on the action path retries.
 */

import type { Action } from './shared/actions.ts';
import * as net from './network/index.ts';

export function dispatch(action: Action): boolean {
  if (net.getIdentity() === null) {
    console.warn('[dispatch] not in a room, ignoring', action.type);
    return false;
  }
  if (!net.isConnected()) {
    console.warn('[dispatch] socket not open, dropping', action.type);
    return false;
  }
  const sent = net.sendAction(action);
  if (!sent) console.warn('[dispatch] send returned false for', action.type);
  return sent;
}
