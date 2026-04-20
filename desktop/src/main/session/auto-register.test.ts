/**
 * Phase 4 invariant tests — SSE is the sole creator of OpenCode
 * `registered_connections` rows, and the MCP transport handle is bound via
 * `updateConnectionId` in a separate step.
 *
 * Invariant (Phase 4, narrowed to provider_type='opencode'):
 *   No `registered_connections` row with provider_type='opencode' ever has
 *   `connection_id = provider_session_id`.
 *
 * These tests exercise the DB primitives that `autoRegisterSession` and
 * `autoRegisterDefaultConnection` call, reproducing the exact insert/bind
 * payloads the main code paths construct.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import {
  initDatabase,
  upsertRegisteredConnection,
  updateConnectionId,
  getRegisteredConnectionBySessionId,
  getDbInstance,
} from '../database';

const TEST_DB_PATH = join(app.getPath('userData'), 'conversations.db');

function freshDb(): Promise<void> {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
  return initDatabase();
}

/**
 * Reproduces the exact insert that `tree-manager.autoRegisterSession` performs
 * for a newly observed OpenCode session. Centralised here so the test stays
 * in lockstep with the production payload shape.
 */
function sseAutoRegisterOpenCodeSession(info: {
  id: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
}): void {
  upsertRegisteredConnection({
    providerSessionId: info.id,
    providerType: 'opencode',
    connectionId: null,
    channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
    projectName: 'OpenCode',
    baseDirectory: info.directory,
    parentSessionId: info.parentID ?? undefined,
  });
}

function countInvariantViolations(): number {
  const db = getDbInstance();
  expect(db).not.toBeNull();
  const row = db!
    .prepare(
      `SELECT COUNT(*) as count FROM registered_connections
       WHERE provider_type = 'opencode'
         AND connection_id IS NOT NULL
         AND connection_id = provider_session_id`,
    )
    .get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

describe('Phase 4 — SSE auto-register invariant', () => {
  beforeEach(freshDb);

  it('inserts OpenCode rows with connection_id = NULL', () => {
    sseAutoRegisterOpenCodeSession({
      id: 'ses_abc123',
      parentID: null,
      title: 'Root Agent',
      directory: '/home/user/project',
    });

    const row = getRegisteredConnectionBySessionId('ses_abc123', 'opencode');
    expect(row).not.toBeNull();
    expect(row!.providerSessionId).toBe('ses_abc123');
    expect(row!.connectionId).toBeNull();
    expect(countInvariantViolations()).toBe(0);
  });

  it('binds the MCP transport id via updateConnectionId, producing a connection_id distinct from provider_session_id', () => {
    // Step 1: SSE creates the row with connection_id = NULL.
    sseAutoRegisterOpenCodeSession({
      id: 'ses_bind_target',
      parentID: null,
      title: 'Root Agent',
      directory: '/home/user/project',
    });

    // Step 2: MCP initialize binds the transport handle.
    const mcpTransportId =
      'transport-uuid-11111111-2222-3333-4444-555555555555';
    updateConnectionId('ses_bind_target', mcpTransportId, 'opencode');

    const bound = getRegisteredConnectionBySessionId(
      'ses_bind_target',
      'opencode',
    );
    expect(bound).not.toBeNull();
    expect(bound!.connectionId).toBe(mcpTransportId);
    expect(bound!.providerSessionId).toBe('ses_bind_target');
    expect(bound!.connectionId).not.toBe(bound!.providerSessionId);
    expect(countInvariantViolations()).toBe(0);
  });

  it('upholds the invariant across a combined flow of many sessions and binds', () => {
    // Simulate several OpenCode sessions created by SSE.
    const sessionIds = [
      'ses_combo_001',
      'ses_combo_002',
      'ses_combo_003',
      'ses_combo_004',
      'ses_combo_005',
    ];
    for (const id of sessionIds) {
      sseAutoRegisterOpenCodeSession({
        id,
        parentID: id === 'ses_combo_001' ? null : 'ses_combo_001',
        title: `Session ${id}`,
        directory: '/home/user/project',
      });
    }

    // Bind transports for a subset (simulating MCP initialize for some, leaving
    // others still pending).
    updateConnectionId(
      'ses_combo_001',
      'transport-aaaa-1111-2222-3333-444444444444',
      'opencode',
    );
    updateConnectionId(
      'ses_combo_003',
      'transport-bbbb-1111-2222-3333-444444444444',
      'opencode',
    );

    // Re-bind one (simulate MCP reconnect — updateConnectionId replaces the
    // existing handle with a fresh transport id).
    updateConnectionId(
      'ses_combo_001',
      'transport-cccc-9999-8888-7777-666666666666',
      'opencode',
    );

    // Invariant must hold for every row across the entire flow.
    expect(countInvariantViolations()).toBe(0);

    // Spot-check one bound and one unbound row.
    const bound = getRegisteredConnectionBySessionId(
      'ses_combo_001',
      'opencode',
    );
    expect(bound!.connectionId).toBe(
      'transport-cccc-9999-8888-7777-666666666666',
    );
    expect(bound!.connectionId).not.toBe(bound!.providerSessionId);

    const unbound = getRegisteredConnectionBySessionId(
      'ses_combo_002',
      'opencode',
    );
    expect(unbound!.connectionId).toBeNull();
  });

  it('detects violations when a test double tries to write connection_id = provider_session_id (regression guard)', () => {
    // Deliberately bypass the SSE helper to write a bad row directly, so we
    // prove the invariant query actually catches violations. This guards
    // against a future regression silently re-introducing the old behaviour.
    upsertRegisteredConnection({
      providerSessionId: 'ses_bad_row',
      providerType: 'opencode',
      connectionId: 'ses_bad_row', // intentional violation
      channelName: 'Bad Row',
      projectName: 'OpenCode',
    });
    expect(countInvariantViolations()).toBe(1);
  });
});
