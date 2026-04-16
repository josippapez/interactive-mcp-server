/**
 * Tests for the upsertRegisteredConnection deduplication logic.
 *
 * Key scenario: two agents with the same channelName but different
 * providerSessionIds (root + subagent both named "Claude Code") must NOT
 * delete each other's rows. With (provider_type, provider_session_id) as the
 * composite PK, each agent's row is identified by its session ID within its
 * provider namespace — channelName is not part of the PK.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import {
  initDatabase,
  upsertRegisteredConnection,
  getAllRegisteredConnections,
  isProviderSessionClaimed,
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
} from './database';

const TEST_DB_PATH = join(app.getPath('userData'), 'conversations.db');

describe('upsertRegisteredConnection deduplication', () => {
  beforeEach(async () => {
    // Remove any persisted DB file so each test starts with a fresh DB
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    await initDatabase();
  });

  it('does NOT delete a sibling row with the same channelName but a different providerSessionId', async () => {
    // Root agent registers with its own session ID (PK)
    upsertRegisteredConnection({
      providerSessionId: 'ses_root_abc',
      providerType: 'opencode',
      connectionId: 'root-conn-uuid',
      channelName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
    });

    // Subagent registers with the same channelName but its own session ID (PK)
    upsertRegisteredConnection({
      providerSessionId: 'ses_sub_xyz',
      providerType: 'opencode',
      connectionId: 'sub-conn-uuid',
      channelName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
    });

    const all = getAllRegisteredConnections();
    const sessionIds = all.map((r) => r.providerSessionId);

    expect(sessionIds).toContain('ses_root_abc');
    expect(sessionIds).toContain('ses_sub_xyz');
    expect(all).toHaveLength(2);
  });

  it('DOES update the row when the same providerSessionId re-registers (same agent restarting)', async () => {
    // First connect — old transport UUID
    upsertRegisteredConnection({
      providerSessionId: 'ses_root_abc',
      providerType: 'opencode',
      connectionId: 'old-transport-uuid',
      channelName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
    });

    // Restart — same session, new transport UUID (PK conflict → UPDATE)
    upsertRegisteredConnection({
      providerSessionId: 'ses_root_abc',
      providerType: 'opencode',
      connectionId: 'new-transport-uuid',
      channelName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
    });

    const all = getAllRegisteredConnections();

    expect(all).toHaveLength(1);
    expect(all[0].providerSessionId).toBe('ses_root_abc');
    expect(all[0].connectionId).toBe('new-transport-uuid');
  });

  it('allows same providerSessionId with different providerTypes (multi-provider isolation)', async () => {
    upsertRegisteredConnection({
      providerSessionId: 'shared-session-id',
      providerType: 'opencode',
      channelName: 'Claude Code',
      projectName: 'my-project',
    });

    upsertRegisteredConnection({
      providerSessionId: 'shared-session-id',
      providerType: 'copilot-cli',
      channelName: 'Claude Code',
      projectName: 'my-project',
    });

    const all = getAllRegisteredConnections();

    // Two distinct (providerType, providerSessionId) composite keys → two rows
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.providerType)).toContain('opencode');
    expect(all.map((r) => r.providerType)).toContain('copilot-cli');
  });

  it('does NOT delete a sibling when new registration has a different session ID', async () => {
    // Root agent already registered with a session
    upsertRegisteredConnection({
      providerSessionId: 'ses_root',
      providerType: 'opencode',
      connectionId: 'root-conn',
      channelName: 'Claude Code',
      projectName: 'my-project',
    });

    // New agent with same name but a different session ID
    upsertRegisteredConnection({
      providerSessionId: 'ses_anon',
      providerType: 'opencode',
      connectionId: 'anon-conn',
      channelName: 'Claude Code',
      projectName: 'my-project',
    });

    const all = getAllRegisteredConnections();
    const sessionIds = all.map((r) => r.providerSessionId);

    // Both should be present — they're different sessions (different PKs)
    expect(sessionIds).toContain('ses_root');
    expect(sessionIds).toContain('ses_anon');
    expect(all).toHaveLength(2);
  });
});

describe('isProviderSessionClaimed', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    await initDatabase();
  });

  it('returns false when no row exists for the given session ID', () => {
    const result = isProviderSessionClaimed('ses_nonexistent', 'opencode');
    expect(result).toBe(false);
  });

  it('returns true when a row exists for the given session ID and provider', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_existing',
      providerType: 'opencode',
      connectionId: 'conn-a',
      channelName: 'Agent A',
      projectName: 'proj',
    });

    const result = isProviderSessionClaimed('ses_existing', 'opencode');
    expect(result).toBe(true);
  });

  it('returns false for a different session ID even if another session exists', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_other',
      providerType: 'opencode',
      connectionId: 'conn-b',
      channelName: 'Agent B',
      projectName: 'proj',
    });

    const result = isProviderSessionClaimed('ses_nonexistent', 'opencode');
    expect(result).toBe(false);
  });

  it('isolates claims by provider type', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_shared',
      providerType: 'opencode',
      channelName: 'OpenCode Agent',
      projectName: 'proj',
    });

    // Same session ID but different provider → not claimed for copilot-cli
    expect(isProviderSessionClaimed('ses_shared', 'opencode')).toBe(true);
    expect(isProviderSessionClaimed('ses_shared', 'copilot-cli')).toBe(false);
  });

  it('still returns true after a session is updated via upsert (idempotent)', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_stable',
      providerType: 'opencode',
      connectionId: 'conn-old',
      channelName: 'Agent',
      projectName: 'proj',
    });

    // Re-register same session with new transport UUID
    upsertRegisteredConnection({
      providerSessionId: 'ses_stable',
      providerType: 'opencode',
      connectionId: 'conn-new',
      channelName: 'Agent',
      projectName: 'proj',
    });

    expect(isProviderSessionClaimed('ses_stable', 'opencode')).toBe(true);
  });
});

describe('getRegisteredConnection secondary lookup by connection_id', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    await initDatabase();
  });

  it('returns the connection when looked up by connectionId', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_lookup',
      providerType: 'opencode',
      connectionId: 'conn-lookup-uuid',
      channelName: 'Lookup Agent',
      projectName: 'proj',
    });

    const result = getRegisteredConnection('conn-lookup-uuid');
    expect(result).not.toBeNull();
    expect(result?.providerSessionId).toBe('ses_lookup');
    expect(result?.connectionId).toBe('conn-lookup-uuid');
  });

  it('returns null when looking up an unknown connectionId', () => {
    const result = getRegisteredConnection('unknown-conn-id');
    expect(result).toBeNull();
  });

  it('returns null for connection_id when it is null (no transport bound yet)', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_no_transport',
      providerType: 'opencode',
      channelName: 'No Transport Agent',
      projectName: 'proj',
    });

    // connectionId is null — cannot look up by it
    const result = getRegisteredConnection('ses_no_transport');
    expect(result).toBeNull();
  });
});

describe('upsertRegisteredConnection baseDirectory preservation', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    await initDatabase();
  });

  it('preserves existing baseDirectory when new value is null/undefined', () => {
    // First upsert sets baseDirectory (like autoRegisterSession does)
    upsertRegisteredConnection({
      providerSessionId: 'ses_preserve_dir',
      providerType: 'opencode',
      connectionId: 'conn-1',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: '/original/path',
    });

    const before = getRegisteredConnectionBySessionId('ses_preserve_dir', 'opencode');
    expect(before?.baseDirectory).toBe('/original/path');

    // Second upsert without baseDirectory (like register_connection without baseDirectory)
    upsertRegisteredConnection({
      providerSessionId: 'ses_preserve_dir',
      providerType: 'opencode',
      connectionId: 'conn-2',
      channelName: 'Agent Updated',
      projectName: 'proj',
      // baseDirectory is undefined
    });

    const after = getRegisteredConnectionBySessionId('ses_preserve_dir', 'opencode');
    expect(after?.baseDirectory).toBe('/original/path'); // Should be preserved
    expect(after?.channelName).toBe('Agent Updated'); // Other fields should update
    expect(after?.connectionId).toBe('conn-2');
  });

  it('updates baseDirectory when new value is provided', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_update_dir',
      providerType: 'opencode',
      connectionId: 'conn-1',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: '/original/path',
    });

    // Second upsert with explicit new baseDirectory
    upsertRegisteredConnection({
      providerSessionId: 'ses_update_dir',
      providerType: 'opencode',
      connectionId: 'conn-2',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: '/new/path',
    });

    const result = getRegisteredConnectionBySessionId('ses_update_dir', 'opencode');
    expect(result?.baseDirectory).toBe('/new/path');
  });
});
