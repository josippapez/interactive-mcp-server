/**
 * Utility-side helper for pushing events to the renderer.
 *
 * The utility process has no direct access to `BrowserWindow`/`webContents`.
 * Instead, it emits a `to-renderer` envelope over the main↔utility bridge;
 * the main-side `utility-supervisor` receives the envelope and forwards the
 * payload via `win.webContents.send(channel, payload)`.
 *
 * All utility-local modules that previously called
 * `getWindow()?.webContents.send(channel, payload)` should now call
 * `emitToRenderer(channel, payload)` instead.
 */

import { getMainRpcOrNull } from './rpc';

export type RendererEmitter = (channel: string, payload: unknown) => void;

export function emitToRenderer(channel: string, payload: unknown): void {
  const bridge = getMainRpcOrNull();
  if (!bridge) return;
  try {
    bridge.emit('to-renderer', { channel, payload });
  } catch {
    // Best-effort: event loss acceptable during teardown.
  }
}
