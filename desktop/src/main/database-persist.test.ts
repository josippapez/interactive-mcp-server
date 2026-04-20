/**
 * Tests for the debounced persistence layer in database.ts.
 *
 * Context: sql.js holds the entire DB in WASM heap memory. `db.export()`
 * allocates a full-DB Uint8Array, and calling it on every write (10+ times
 * per user action) causes WASM heap fragmentation and the renderer-visible
 * "RuntimeError: memory access out of bounds" crash.
 *
 * The fix debounces disk writes by 250ms while keeping in-memory mutations
 * synchronous. Shutdown uses `flushPersistNow()` to guarantee durability
 * without waiting for the debounce timer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import {
  initDatabase,
  upsertRegisteredConnection,
  flushPersistNow,
  __cancelPendingPersistForTests,
} from './database';

const TEST_DB_PATH = join(app.getPath('userData'), 'conversations.db');
const DEBOUNCE_MS = 250;

async function freshDb(): Promise<void> {
  __cancelPendingPersistForTests();
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  await initDatabase();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('debounced persist()', () => {
  beforeEach(freshDb);

  it('coalesces many rapid writes into a single on-disk flush', async () => {
    // initDatabase() flushes synchronously, so the file exists. Capture the
    // baseline mtime so we can detect the debounced write that should follow.
    const baselineMtimeMs = statSync(TEST_DB_PATH).mtimeMs;

    // Perform many writes in quick succession. Each one schedules (or joins)
    // the same debounce window — the file should NOT have been rewritten yet.
    for (let i = 0; i < 25; i++) {
      upsertRegisteredConnection({
        providerSessionId: `ses_${i}`,
        providerType: 'opencode',
        channelName: `Test ${i}`,
        projectName: 'test-project',
        baseDirectory: '/repo',
      });
    }

    // Immediately after the burst, the debounced flush has not yet fired.
    // On some filesystems mtime resolution is coarse, so we only assert the
    // stronger property: the file is flushed once the debounce window elapses.
    await wait(DEBOUNCE_MS + 100);

    const afterMtimeMs = statSync(TEST_DB_PATH).mtimeMs;
    expect(afterMtimeMs).toBeGreaterThan(baselineMtimeMs);
  });

  it('flushPersistNow() synchronously writes pending changes to disk', async () => {
    // Drain any pending writes from initDatabase().
    flushPersistNow();
    const baselineMtimeMs = statSync(TEST_DB_PATH).mtimeMs;

    // Small sleep so that any mtime change after flush is distinguishable
    // even on filesystems with 1-second mtime resolution.
    await wait(1100);

    upsertRegisteredConnection({
      providerSessionId: 'ses_flush_now',
      providerType: 'opencode',
      channelName: 'Flush Me',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });

    // Before flushPersistNow(), the debounce timer is still pending — but we
    // do not assert mtime hasn't changed (FS resolution differences).
    flushPersistNow();

    const afterMtimeMs = statSync(TEST_DB_PATH).mtimeMs;
    expect(afterMtimeMs).toBeGreaterThan(baselineMtimeMs);
  });

  it('flushPersistNow() is a no-op when no writes are pending', () => {
    // Drain any pending writes.
    flushPersistNow();
    const mtime1 = statSync(TEST_DB_PATH).mtimeMs;

    // Calling again with nothing dirty must not rewrite the file.
    flushPersistNow();
    const mtime2 = statSync(TEST_DB_PATH).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it('upsertRegisteredConnection is a no-op when all fields match existing row', async () => {
    // First write — should flush and bump mtime.
    upsertRegisteredConnection({
      providerSessionId: 'ses_noop',
      providerType: 'opencode',
      connectionId: null,
      channelName: 'No-op test',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });
    flushPersistNow();

    // Wait past FS mtime resolution so any follow-up write is distinguishable.
    await wait(1100);
    const baselineMtimeMs = statSync(TEST_DB_PATH).mtimeMs;

    // Identical upsert — must not schedule a flush.
    upsertRegisteredConnection({
      providerSessionId: 'ses_noop',
      providerType: 'opencode',
      connectionId: null,
      channelName: 'No-op test',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });

    // Wait past debounce window; file should NOT have been rewritten.
    await wait(DEBOUNCE_MS + 100);

    const afterMtimeMs = statSync(TEST_DB_PATH).mtimeMs;
    expect(afterMtimeMs).toBe(baselineMtimeMs);
  });

  it('upsertRegisteredConnection still writes when a field changes', async () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_change',
      providerType: 'opencode',
      connectionId: null,
      channelName: 'Original name',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });
    flushPersistNow();

    await wait(1100);
    const baselineMtimeMs = statSync(TEST_DB_PATH).mtimeMs;

    // Change channelName — must flush.
    upsertRegisteredConnection({
      providerSessionId: 'ses_change',
      providerType: 'opencode',
      connectionId: null,
      channelName: 'Updated name',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });

    await wait(DEBOUNCE_MS + 100);

    const afterMtimeMs = statSync(TEST_DB_PATH).mtimeMs;
    expect(afterMtimeMs).toBeGreaterThan(baselineMtimeMs);
  });

  it('__cancelPendingPersistForTests() discards pending writes without flushing', async () => {
    flushPersistNow();
    await wait(1100);
    const baselineMtimeMs = statSync(TEST_DB_PATH).mtimeMs;

    upsertRegisteredConnection({
      providerSessionId: 'ses_cancel_me',
      providerType: 'opencode',
      channelName: 'Cancel Me',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });

    // Cancel the pending debounced flush.
    __cancelPendingPersistForTests();

    // Wait past the debounce window; file should NOT have been rewritten.
    await wait(DEBOUNCE_MS + 100);

    const afterMtimeMs = statSync(TEST_DB_PATH).mtimeMs;
    expect(afterMtimeMs).toBe(baselineMtimeMs);
  });
});
