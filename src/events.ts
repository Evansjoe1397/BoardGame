/**
 * Typed event bus — replaces the registerDeps() late-binding pattern.
 * Modules emit/listen to typed events instead of passing function references.
 */

type EventHandler = (...args: unknown[]) => unknown;

const listeners = new Map<string, EventHandler[]>();

export function on<K extends string>(event: K, handler: EventHandler): void {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }
  listeners.get(event)!.push(handler);
}

export function off<K extends string>(event: K, handler: EventHandler): void {
  const handlers = listeners.get(event);
  if (!handlers) return;
  const idx = handlers.indexOf(handler);
  if (idx >= 0) handlers.splice(idx, 1);
}

export function emit<K extends string>(event: K, ...args: unknown[]): void {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    handler(...args);
  }
}

/**
 * Call a single registered handler and return its result.
 * Used for functions that produce a value (e.g., getPlayerMaxEnergy).
 */
export function call<R>(event: string, ...args: unknown[]): R | undefined {
  const handlers = listeners.get(event);
  if (!handlers || handlers.length === 0) return undefined;
  return handlers[0](...args) as R;
}
