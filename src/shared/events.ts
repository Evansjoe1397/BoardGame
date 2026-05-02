/**
 * Pure-engine event bus.
 *
 * The engine modules (under src/engine/) used to call DOM/Three.js side-effects
 * directly (addLog, syncBoardVisualState, renderUI, playRifleShot, …).
 * To make the engine usable on a Bun server with no DOM, those calls now emit
 * typed events into a buffer. A client-side applier later reads the buffer
 * and runs the real side-effects.
 *
 * Convention:
 *   - Engine code calls `addLog(...)`, `syncBoardVisualState()`, etc. exactly
 *     as before — but these are now shims that push events.
 *   - After every top-level engine call, `flushEvents()` returns the events
 *     produced and the caller (client dispatcher or server room) decides what
 *     to do with them.
 */

import type { PlayerId } from '../types.ts';

export interface ExplosionEffectOptions {
  particleCount?: number;
  duration?: number;
  speedMin?: number;
  speedMax?: number;
}

export type GameEvent =
  // Logging — always pushed; client appends to log panel, server may forward.
  | { type: 'LOG'; message: string }

  // Coarse "redraw" signals — emitted by current code paths. These will be
  // refined into semantic events (UNIT_MOVED, UNIT_DAMAGED, …) in later stages.
  | { type: 'BOARD_SYNC' }
  | { type: 'UI_REFRESH' }

  // Visual / animation effect requests.
  | { type: 'EFFECT_RIFLE_SHOT'; attackerId: string; targetPos: { x: number; y: number; z: number } }
  | { type: 'EFFECT_HIT'; unitId: string }
  | { type: 'EFFECT_EXPLOSION'; pos: { x: number; y: number; z: number }; options?: ExplosionEffectOptions }
  | { type: 'EFFECT_REPAIR_CASTER'; casterId: string }
  | { type: 'EFFECT_REPAIR_TARGET'; targetId: string }
  | { type: 'EFFECT_SUPPLY_HARVEST_COINS'; unitId: string }
  | { type: 'EFFECT_SUPPLY_HARVEST_FLASH' }

  // Lifecycle markers — used by client to time animation gaps. Server-broadcast
  // version of these events will be added in stage C with full semantics.
  | { type: 'BASE_DESTROYED'; player: PlayerId }

  // Granular movement event — drives the walk animation on BOTH the acting
  // client and any client that receives this event over the wire (without it
  // the receiver would teleport the unit when applying a snapshot).
  | {
      type: 'UNIT_MOVED';
      unitId: string;
      fromX: number;
      fromZ: number;
      toX: number;
      toZ: number;
    };

/** Shape utility: pick a single event variant by its `type` discriminator. */
export type EventOfType<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

/** Handler signature for one event variant. */
export type EventHandler<T extends GameEvent['type']> = (event: EventOfType<T>) => void;

let eventBuffer: GameEvent[] = [];

/**
 * Sink that consumes events drained from the buffer. Set once at startup
 * by the host environment:
 *   - Browser client → applies events to DOM / Three.js
 *   - Bun server     → broadcasts events to connected clients
 *   - Tests          → may collect into an array
 */
export type EventSink = (events: GameEvent[]) => void;
let sink: EventSink | null = null;
let flushScheduled = false;

export function setEventSink(fn: EventSink): void {
  sink = fn;
}

/** Push a single event into the current buffer. */
export function emit(event: GameEvent): void {
  eventBuffer.push(event);
  if (sink && !flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const drained = eventBuffer;
      eventBuffer = [];
      sink!(drained);
    });
  }
}

/** Drain the buffer synchronously (e.g. server reducer call sites). */
export function flushEvents(): GameEvent[] {
  const out = eventBuffer;
  eventBuffer = [];
  return out;
}

/** Discard buffered events (e.g. when an action was rejected mid-flight). */
export function clearEvents(): void {
  eventBuffer = [];
}

// ---------------------------------------------------------------------------
// Drop-in shims for the side-effects the engine used to call directly.
// Engine modules should `import { addLog, syncBoardVisualState, renderUI }
// from '../shared/events.ts'` — same call signatures, no behaviour change in
// the engine, but the actual UI work is deferred to the event applier.
// ---------------------------------------------------------------------------

export function addLog(message: string): void {
  emit({ type: 'LOG', message });
}

export function syncBoardVisualState(): void {
  emit({ type: 'BOARD_SYNC' });
}

export function renderUI(): void {
  emit({ type: 'UI_REFRESH' });
}
