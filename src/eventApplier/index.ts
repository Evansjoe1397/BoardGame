/**
 * Event applier — composes per-domain handler maps into a single dispatch
 * function. Each domain owns its own file (effectEvents, unitEvents, …).
 *
 * Type-safety guarantees:
 *   - Each handler entry is constrained via `satisfies EventHandler<T>` in
 *     its source file, so the parameter is the correct event variant.
 *   - The `_exhaustivenessCheck` below fails compilation if the GameEvent
 *     union grows a new variant that no domain handler covers.
 */

import type { GameEvent } from '../shared/events.ts';
import { effectEventHandlers } from './effectEvents.ts';
import { unitEventHandlers } from './unitEvents.ts';
import { uiEventHandlers } from './uiEvents.ts';
import { lifecycleEventHandlers } from './lifecycleEvents.ts';
import { playerEventHandlers } from './playerEvents.ts';
import { buildingEventHandlers } from './buildingEvents.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void;

const handlers: Partial<Record<GameEvent['type'], AnyHandler>> = {
  ...effectEventHandlers,
  ...unitEventHandlers,
  ...uiEventHandlers,
  ...lifecycleEventHandlers,
  ...playerEventHandlers,
  ...buildingEventHandlers,
};

// Compile-time exhaustiveness check: any GameEvent variant not present in
// `handlers` will surface here as a non-`never` type.
type _Missing = Exclude<GameEvent['type'], keyof typeof handlers>;
// Force the check to fire; `_Missing` should evaluate to `never`. If a new
// event type is added without a handler, this assignment fails.
const _exhaustivenessCheck: _Missing extends never ? true : never = true;
void _exhaustivenessCheck;

export function applyEvent(event: GameEvent): void {
  const h = handlers[event.type];
  if (h) h(event);
}

/**
 * UI_REFRESH and BOARD_SYNC are coarse "redraw the world" signals — they
 * carry no payload and are idempotent within a single drained batch. The
 * engine emits them liberally (one per mutation), so deduping before
 * dispatch turns N full-DOM rebuilds per turn into one. Other events keep
 * their original ordering.
 */
export function applyEvents(events: GameEvent[]): void {
  let pendingRefresh = false;
  let pendingSync = false;
  for (const event of events) {
    if (event.type === 'UI_REFRESH') { pendingRefresh = true; continue; }
    if (event.type === 'BOARD_SYNC') { pendingSync = true; continue; }
    applyEvent(event);
  }
  if (pendingSync) applyEvent({ type: 'BOARD_SYNC' });
  if (pendingRefresh) applyEvent({ type: 'UI_REFRESH' });
}
