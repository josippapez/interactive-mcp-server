/**
 * Node-IPC port shim — adapts a Node `child_process` IPC channel to the
 * `PortLike` interface that {@link Bridge} expects.
 *
 * # Why this exists
 *
 * `Bridge` (in `src/main/utility/bridge.ts`) speaks the
 * `MessagePortMain` / Web `MessagePort` shape: `postMessage`, `on('message')`,
 * `on('close')`, `start?()`. Mode B uses Electron's `MessageChannelMain` for
 * that shape directly.
 *
 * Mode B' (and Mode C in the future) spawn the host via Node's
 * `child_process.fork()` instead of Electron's `utilityProcess.fork()`. Node's
 * builtin IPC channel uses a different surface — `process.send(msg)` /
 * `process.on('message', cb)` on the child side, and `child.send(msg)` /
 * `child.on('message', cb)` on the parent side.
 *
 * This shim wraps either side into a `PortLike` so the same `Bridge` code
 * works unchanged.
 *
 * # Topology constraint
 *
 * This file is platform-neutral — it imports nothing from `electron` and
 * nothing from a specific bundle layout. It is safe to import from BOTH:
 *   - The main-process bundle (parent-side adapter when spawning)
 *   - The host-process bundle (child-side adapter at boot)
 *
 * Keep it that way. If you ever need Electron-specific handling, put it in
 * a different file.
 *
 * # Wire format
 *
 * Bridge envelopes are plain JSON-serialisable objects, which is exactly
 * what Node IPC supports natively. No custom serialisation is needed.
 */

import type { ChildProcess } from 'node:child_process';

/**
 * Minimum surface this shim depends on. Both `process` (child side) and
 * `ChildProcess` (parent side) implement this when an IPC channel is open.
 */
interface NodeIpcEndpoint {
  send?: (message: unknown) => boolean;
  on(event: 'message', listener: (msg: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  on(event: 'exit', listener: () => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: unknown[]) => void,
  ): unknown;
  disconnect?: () => void;
}

/**
 * The `PortLike` shape Bridge consumes. Re-declared here (instead of imported
 * from `bridge.ts`) so this shim stays decoupled from the main-process bundle.
 * If Bridge's interface drifts, update this declaration to match.
 */
interface PortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  on(event: 'close', listener: () => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  start?(): void;
  close?(): void;
}

/**
 * Wrap a Node IPC endpoint (parent's `ChildProcess` OR child's `process`)
 * into a `PortLike` Bridge can drive.
 *
 * The wrapper:
 *   - Translates `postMessage(env)` → `endpoint.send(env)`. If `send` returns
 *     false (channel backpressured/closed) we log a warning but do not throw,
 *     mirroring `MessagePortMain`'s fire-and-forget semantics.
 *   - Translates `on('message', cb)` to attaching a Node `'message'` listener
 *     and wrapping each delivery into the `{ data }` shape Bridge expects.
 *   - Maps Bridge's `on('close', cb)` to Node's `'disconnect'` AND `'exit'`
 *     events, whichever fires first. This ensures pending requests reject
 *     promptly when the channel goes away (parent side: child crash; child
 *     side: parent killed/disconnect).
 *
 * `start()` is a no-op — Node IPC channels deliver messages immediately.
 * `close()` calls `disconnect()` if available; otherwise no-op (the exit
 * itself will close the channel).
 */
export function createNodeIpcPortShim(endpoint: NodeIpcEndpoint): PortLike {
  const messageListeners = new Set<(e: { data: unknown }) => void>();
  const closeListeners = new Set<() => void>();
  let closed = false;

  const onNodeMessage = (msg: unknown): void => {
    for (const cb of messageListeners) {
      try {
        cb({ data: msg });
      } catch (err) {
        console.warn('[node-ipc-port-shim] message listener threw:', err);
      }
    }
  };

  const onNodeClose = (): void => {
    if (closed) return;
    closed = true;
    for (const cb of closeListeners) {
      try {
        cb();
      } catch (err) {
        console.warn('[node-ipc-port-shim] close listener threw:', err);
      }
    }
  };

  endpoint.on('message', onNodeMessage);
  // Either side may emit `disconnect` (channel closed cleanly) or `exit`
  // (child died). Whichever happens first means messages can no longer flow.
  endpoint.on('disconnect', onNodeClose);
  endpoint.on('exit', onNodeClose);

  return {
    postMessage(message: unknown): void {
      if (closed) return;
      try {
        const sent = endpoint.send?.(message);
        if (sent === false) {
          console.warn(
            '[node-ipc-port-shim] endpoint.send returned false (channel backpressured or closed)',
          );
        }
      } catch (err) {
        console.warn('[node-ipc-port-shim] send threw:', err);
      }
    },
    on(event: 'message' | 'close', listener: never): void {
      if (event === 'message') {
        messageListeners.add(listener as (e: { data: unknown }) => void);
      } else {
        closeListeners.add(listener as () => void);
      }
    },
    off(event: string, listener: (...args: unknown[]) => void): void {
      if (event === 'message') {
        messageListeners.delete(
          listener as unknown as (e: { data: unknown }) => void,
        );
      } else if (event === 'close') {
        closeListeners.delete(listener as unknown as () => void);
      }
    },
    start(): void {
      // Node IPC has no explicit start — messages flow as soon as the
      // channel is ready, which is before this constructor is reached.
    },
    close(): void {
      if (closed) return;
      try {
        endpoint.disconnect?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Convenience: build a port shim around a `ChildProcess` parent endpoint.
 * Throws synchronously if the child has no IPC channel (i.e. was spawned
 * without `'ipc'` in `stdio`).
 */
export function createParentSidePort(child: ChildProcess): PortLike {
  if (typeof child.send !== 'function') {
    throw new Error(
      "[node-ipc-port-shim] child has no IPC channel — was it spawned with stdio: [..., 'ipc']?",
    );
  }
  return createNodeIpcPortShim(child as unknown as NodeIpcEndpoint);
}

/**
 * Convenience: build a port shim around the current `process` (child side).
 * Throws synchronously if `process.send` is missing — i.e. this entry was
 * not launched via `child_process.fork()` with an IPC channel.
 */
export function createChildSidePort(): PortLike {
  const proc = process as unknown as NodeIpcEndpoint;
  if (typeof proc.send !== 'function') {
    throw new Error(
      '[node-ipc-port-shim] process.send is undefined — this entry must be launched via child_process.fork() with an IPC channel',
    );
  }
  return createNodeIpcPortShim(proc);
}
