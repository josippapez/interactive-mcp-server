/**
 * Typed request/reply bridge over an Electron `MessagePortMain`.
 *
 * Used by main ↔ utility-process communication (see
 * `docs/BACKEND-UTILITY-PROCESS-PLAN.md`). Both ends instantiate the same
 * `Bridge` class over their end of the port; the API is symmetric.
 *
 * Wire format
 * -----------
 *   Request:  { kind: 'req', id: number, method: string, payload?: unknown }
 *   Reply OK: { kind: 'res', id: number, ok: true,  result?: unknown }
 *   Reply KO: { kind: 'res', id: number, ok: false, error: string }
 *   Event:    { kind: 'evt', topic: string, payload?: unknown }
 *
 * The wrapping keeps `request()` promises correlated via `id`, while
 * `emit()`/`on()` provide a fire-and-forget pub-sub for server-push events
 * (utility → main: `to-renderer`, `ready`, etc).
 *
 * Design notes
 * ------------
 *   - `method` is a plain string. The caller supplies the generic types so
 *     only the call site knows the shape. This keeps this module zero-dep and
 *     reusable by both the main-side supervisor and the utility entry.
 *   - Reply errors are serialized as strings (stack traces dropped). Callers
 *     that need richer errors should encode them in the payload.
 *   - `dispose()` aborts pending requests with `Bridge disposed` so callers
 *     don't leak promises when the port closes.
 *
 * NOT a full RPC framework. If we need cancellation, streaming, or schema
 * validation later, layer it on top (don't extend this file).
 */

// Electron's MessagePortMain and Web MessagePort share the same surface we
// need (postMessage + on('message') + start/close). Accept either so tests
// can use a plain `MessageChannel` from 'node:worker_threads'.
export interface PortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  on(event: 'close', listener: () => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  start?(): void;
  close?(): void;
}

type RequestEnvelope = {
  kind: 'req';
  id: number;
  method: string;
  payload?: unknown;
};

type ReplyEnvelopeOk = {
  kind: 'res';
  id: number;
  ok: true;
  result?: unknown;
};

type ReplyEnvelopeErr = {
  kind: 'res';
  id: number;
  ok: false;
  error: string;
};

type EventEnvelope = {
  kind: 'evt';
  topic: string;
  payload?: unknown;
};

type Envelope =
  | RequestEnvelope
  | ReplyEnvelopeOk
  | ReplyEnvelopeErr
  | EventEnvelope;

type MethodHandler = (payload: unknown) => unknown | Promise<unknown>;
type EventHandler = (payload: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

export interface BridgeOptions {
  /**
   * Logging tag. Prepended to all warn/error logs so dev can tell which end
   * of the bridge is logging. Typically `'main'` or `'utility'`.
   */
  tag: string;
  /**
   * Default per-request timeout. Undefined = no timeout. Individual calls can
   * still override via `request()` options.
   */
  defaultRequestTimeoutMs?: number;
}

export class Bridge {
  private readonly port: PortLike;
  private readonly tag: string;
  private readonly defaultTimeoutMs: number | undefined;
  private readonly handlers = new Map<string, MethodHandler>();
  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;

  constructor(port: PortLike, opts: BridgeOptions) {
    this.port = port;
    this.tag = opts.tag;
    this.defaultTimeoutMs = opts.defaultRequestTimeoutMs;

    port.on('message', (e: { data: unknown }) => this.onMessage(e.data));
    port.on('close', () => this.dispose('port closed'));

    // MessagePortMain must be started explicitly before it delivers events.
    port.start?.();
  }

  /** Register a handler for an incoming request `method`. */
  handle(method: string, handler: MethodHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(
        `[bridge:${this.tag}] handler already registered for "${method}"`,
      );
    }
    this.handlers.set(method, handler);
  }

  /**
   * Send a request and await a reply. Rejects on timeout, peer error reply,
   * or port closure.
   */
  request<TReply = unknown>(
    method: string,
    payload?: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<TReply> {
    if (this.disposed) {
      return Promise.reject(
        new Error(`[bridge:${this.tag}] disposed; cannot send "${method}"`),
      );
    }

    const id = this.nextId++;
    const env: RequestEnvelope = { kind: 'req', id, method, payload };

    return new Promise<TReply>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
      if (timeoutMs !== undefined && timeoutMs > 0) {
        const timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(
              new Error(
                `[bridge:${this.tag}] request "${method}" timed out after ${timeoutMs}ms`,
              ),
            );
          }
        }, timeoutMs);
        // Ensure timer doesn't keep the process alive (utility idle path).
        timer.unref?.();
      }

      try {
        this.port.postMessage(env);
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Fire a topic event to the peer. No reply expected. */
  emit(topic: string, payload?: unknown): void {
    if (this.disposed) return;
    const env: EventEnvelope = { kind: 'evt', topic, payload };
    try {
      this.port.postMessage(env);
    } catch (err) {
      // Swallow: event loss is acceptable during teardown.
      console.warn(`[bridge:${this.tag}] emit "${topic}" failed:`, err);
    }
  }

  /** Subscribe to a topic event from the peer. Returns an unsubscribe fn. */
  on(topic: string, handler: EventHandler): () => void {
    let set = this.eventHandlers.get(topic);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(topic, set);
    }
    set.add(handler);
    return () => {
      this.eventHandlers.get(topic)?.delete(handler);
    };
  }

  /** Tear down the bridge. Rejects all pending requests. */
  dispose(reason = 'disposed'): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, req] of this.pending) {
      req.reject(
        new Error(
          `[bridge:${this.tag}] ${reason} before "${req.method}" replied`,
        ),
      );
    }
    this.pending.clear();
    this.handlers.clear();
    this.eventHandlers.clear();
    try {
      this.port.close?.();
    } catch {
      /* ignore */
    }
  }

  private onMessage(raw: unknown): void {
    if (!isEnvelope(raw)) {
      console.warn(`[bridge:${this.tag}] dropped non-envelope message`, raw);
      return;
    }

    switch (raw.kind) {
      case 'req':
        void this.onRequest(raw);
        return;
      case 'res':
        this.onReply(raw);
        return;
      case 'evt':
        this.onEvent(raw);
        return;
    }
  }

  private async onRequest(env: RequestEnvelope): Promise<void> {
    const handler = this.handlers.get(env.method);
    if (!handler) {
      const reply: ReplyEnvelopeErr = {
        kind: 'res',
        id: env.id,
        ok: false,
        error: `no handler for "${env.method}"`,
      };
      this.safeSend(reply);
      return;
    }

    try {
      const result = await handler(env.payload);
      const reply: ReplyEnvelopeOk = {
        kind: 'res',
        id: env.id,
        ok: true,
        result,
      };
      this.safeSend(reply);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const reply: ReplyEnvelopeErr = {
        kind: 'res',
        id: env.id,
        ok: false,
        error,
      };
      this.safeSend(reply);
    }
  }

  private onReply(env: ReplyEnvelopeOk | ReplyEnvelopeErr): void {
    const pending = this.pending.get(env.id);
    if (!pending) {
      console.warn(`[bridge:${this.tag}] reply for unknown id=${env.id}`);
      return;
    }
    this.pending.delete(env.id);
    if (env.ok) {
      pending.resolve(env.result);
    } else {
      pending.reject(new Error(env.error));
    }
  }

  private onEvent(env: EventEnvelope): void {
    const set = this.eventHandlers.get(env.topic);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(env.payload);
      } catch (err) {
        console.warn(
          `[bridge:${this.tag}] event handler for "${env.topic}" threw:`,
          err,
        );
      }
    }
  }

  private safeSend(env: Envelope): void {
    if (this.disposed) return;
    try {
      this.port.postMessage(env);
    } catch (err) {
      console.warn(`[bridge:${this.tag}] send failed:`, err);
    }
  }
}

function isEnvelope(v: unknown): v is Envelope {
  if (v === null || typeof v !== 'object') return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === 'req' || kind === 'res' || kind === 'evt';
}
