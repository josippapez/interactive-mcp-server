/**
 * Tests for the upsertRegisteredConnection deduplication logic.
 *
 * Key scenario: two agents with the same agentName but different
 * openCodeSessionIds (root + subagent both named "Claude Code") must NOT
 * delete each other's rows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  initDatabase,
  upsertRegisteredConnection,
  getAllRegisteredConnections,
} from './database';

const TEST_DB_PATH = join('/tmp', 'conversations.db');

describe('upsertRegisteredConnection deduplication', () => {
  beforeEach(async () => {
    // Remove any persisted DB file so each test starts with a fresh DB
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    await initDatabase();
  });

  it('does NOT delete a sibling row with the same agentName but a different openCodeSessionId', async () => {
    // Root agent registers
    upsertRegisteredConnection({
      connectionId: 'root-conn-uuid',
      agentName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
      openCodeSessionId: 'ses_root_abc',
    });

    // Subagent registers with the same agentName but its own session ID
    upsertRegisteredConnection({
      connectionId: 'sub-conn-uuid',
      agentName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
      openCodeSessionId: 'ses_sub_xyz',
    });

    const all = getAllRegisteredConnections();
    const ids = all.map((r) => r.connectionId);

    expect(ids).toContain('root-conn-uuid');
    expect(ids).toContain('sub-conn-uuid');
    expect(all).toHaveLength(2);
  });

  it('DOES deduplicate rows with the same agentName AND same openCodeSessionId (same agent restarting)', async () => {
    // First connect — transport UUID A
    upsertRegisteredConnection({
      connectionId: 'old-transport-uuid',
      agentName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
      openCodeSessionId: 'ses_root_abc',
    });

    // Restart — same session, new transport UUID B
    upsertRegisteredConnection({
      connectionId: 'new-transport-uuid',
      agentName: 'Claude Code',
      projectName: 'my-project',
      baseDirectory: '/repo',
      openCodeSessionId: 'ses_root_abc',
    });

    const all = getAllRegisteredConnections();

    expect(all).toHaveLength(1);
    expect(all[0].connectionId).toBe('new-transport-uuid');
  });

  it('DOES deduplicate rows with the same agentName when both have no openCodeSessionId', async () => {
    upsertRegisteredConnection({
      connectionId: 'old-conn',
      agentName: 'Claude Code',
      projectName: 'my-project',
    });

    upsertRegisteredConnection({
      connectionId: 'new-conn',
      agentName: 'Claude Code',
      projectName: 'my-project',
    });

    const all = getAllRegisteredConnections();

    expect(all).toHaveLength(1);
    expect(all[0].connectionId).toBe('new-conn');
  });

  it('does NOT delete a sibling when new registration has no openCodeSessionId but existing does', async () => {
    // Root agent already registered with a session
    upsertRegisteredConnection({
      connectionId: 'root-conn',
      agentName: 'Claude Code',
      projectName: 'my-project',
      openCodeSessionId: 'ses_root',
    });

    // New agent with same name but no session ID (e.g. a tool-less MCP client)
    upsertRegisteredConnection({
      connectionId: 'anon-conn',
      agentName: 'Claude Code',
      projectName: 'my-project',
      openCodeSessionId: undefined,
    });

    const all = getAllRegisteredConnections();
    const ids = all.map((r) => r.connectionId);

    // Both should be present — they're different instances
    expect(ids).toContain('root-conn');
    expect(ids).toContain('anon-conn');
  });
});
