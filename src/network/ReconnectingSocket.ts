/**
 * Auto-reconnecting WebSocket wrapper.
 *
 * - Exponential backoff with ±20% jitter, capped at 30s.
 * - Resets the attempt counter on every successful open.
 * - Emits 'connected' / 'disconnected' lifecycle events that the host
 *   application uses to drive a UI banner and (if applicable) re-send a
 *   `rejoin` message after each reconnect.
 *
 * Heartbeat (application-level ping/pong) is layered on top: every 30s while
 * connected, send `{ type: 'ping' }`. If `lastPongAt` is older than the
 * threshold, force-close the socket so the reconnect path runs.
 *
 * Page Visibility / Page Lifecycle integration is wired by the host module
 * (src/network/index.ts) — this class only owns the transport.
 */

type Listener<T> = (value: T) => void;

export interface SocketEvents {
  connected: void;
  disconnected: void;
  message: unknown;
}

const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;

export class ReconnectingSocket {
  private url: string;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private intentional = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;

  private listeners: { [K in keyof SocketEvents]: Listener<SocketEvents[K]>[] } = {
    connected: [],
    disconnected: [],
    message: [],
  };

  constructor(url: string) {
    this.url = url;
  }

  on<K extends keyof SocketEvents>(event: K, fn: Listener<SocketEvents[K]>): () => void {
    this.listeners[event].push(fn);
    return () => {
      const arr = this.listeners[event] as Listener<SocketEvents[K]>[];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  private emit<K extends keyof SocketEvents>(event: K, value: SocketEvents[K]): void {
    for (const fn of this.listeners[event] as Listener<SocketEvents[K]>[]) {
      try {
        fn(value);
      } catch (err) {
        console.error(`[net] listener for ${event} threw`, err);
      }
    }
  }

  /** Returns true when the underlying socket is OPEN. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.intentional = false;
    this.openSocket();
  }

  close(): void {
    this.intentional = true;
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  /** Send an arbitrary JSON-serialisable payload. Drops silently if not connected. */
  send(payload: unknown): boolean {
    if (!this.isConnected()) return false;
    try {
      this.ws!.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('[net] send failed', err);
      return false;
    }
  }

  /** Force a reconnect immediately (e.g. on `visibilitychange` to visible). */
  forceReconnect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    } else {
      this.openSocket();
    }
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.lastPongAt = Date.now();
      this.startHeartbeat();
      this.emit('connected', undefined);
    });

    ws.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        console.warn('[net] non-JSON message dropped');
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed && (parsed as { type: string }).type === 'pong') {
        this.lastPongAt = Date.now();
        return;
      }
      this.emit('message', parsed);
    });

    ws.addEventListener('close', (event) => {
      console.warn(
        `[net] ws closed code=${event.code} reason=${JSON.stringify(event.reason)} clean=${event.wasClean}`,
      );
      this.stopHeartbeat();
      this.ws = null;
      this.emit('disconnected', undefined);
      if (this.intentional) return;
      this.scheduleReconnect();
    });

    ws.addEventListener('error', (event) => {
      console.warn('[net] ws error', event);
      // 'close' fires after 'error', so we don't schedule reconnect here.
    });
  }

  private scheduleReconnect(): void {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    const jittered = base * (0.8 + Math.random() * 0.4);
    this.attempt++;
    setTimeout(() => {
      if (!this.intentional) this.openSocket();
    }, jittered);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return;
      // If the last pong is older than the threshold, force-close to trigger reconnect.
      if (Date.now() - this.lastPongAt > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
        console.warn('[net] heartbeat timeout — forcing reconnect');
        try { this.ws!.close(); } catch { /* ignore */ }
        return;
      }
      this.send({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
