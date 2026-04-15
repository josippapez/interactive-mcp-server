/**
 * Tests for Phase 2 database.ts changes:
 * - Composite primary key (provider_type, provider_session_id)
 * - getRegisteredConnectionBySessionId (new primary lookup with providerType)
 * - updateConnectionId (new: bind transport handle)
 * - upsertRegisteredConnection with required providerSessionId/openCodeSessionId
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import {
  initDatabase,
  upsertRegisteredConnection,
  getAllRegisteredConnections,
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
  updateConnectionId,
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
} from './database';

const TEST_DB_PATH = join(app.getPath('userData'), 'conversations.db');

function freshDb(): Promise<void> {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
  return initDatabase();
}

describe('getRegisteredConnectionBySessionId', () => {
  beforeEach(freshDb);

  it('returns null when no connection exists for the given session ID', () => {
    const result = getRegisteredConnectionBySessionId(
      'ses_nonexistent',
      'opencode',
    );
    expect(result).toBeNull();
  });

  it('returns the connection when it exists with the given openCodeSessionId', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_abc123',
      providerType: 'opencode',
      channelName: 'Test Agent',
      projectName: 'test-project',
      baseDirectory: '/repo',
    });

    const result = getRegisteredConnectionBySessionId('ses_abc123', 'opencode');

    expect(result).not.toBeNull();
    expect(result?.providerSessionId).toBe('ses_abc123');
    expect(result?.channelName).toBe('Test Agent');
    expect(result?.projectName).toBe('test-project');
    expect(result?.baseDirectory).toBe('/repo');
  });

  it('returns null when searching for a different session ID', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_abc123',
      providerType: 'opencode',
      channelName: 'Test Agent',
      projectName: 'test-project',
    });

    const result = getRegisteredConnectionBySessionId('ses_other', 'opencode');
    expect(result).toBeNull();
  });

  it('returns the connection even when connectionId is null', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_no_transport',
      providerType: 'opencode',
      channelName: 'SSE Agent',
      projectName: 'my-project',
    });

    const result = getRegisteredConnectionBySessionId(
      'ses_no_transport',
      'opencode',
    );

    expect(result).not.toBeNull();
    expect(result?.connectionId).toBeNull();
    expect(result?.providerSessionId).toBe('ses_no_transport');
  });

  it('isolates connections by providerType (multi-provider support)', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_shared_id',
      providerType: 'opencode',
      channelName: 'OpenCode Agent',
      projectName: 'proj',
    });
    upsertRegisteredConnection({
      providerSessionId: 'ses_shared_id',
      providerType: 'copilot-cli',
      channelName: 'Copilot Agent',
      projectName: 'proj',
    });

    const opencode = getRegisteredConnectionBySessionId(
      'ses_shared_id',
      'opencode',
    );
    const copilot = getRegisteredConnectionBySessionId(
      'ses_shared_id',
      'copilot-cli',
    );

    expect(opencode?.channelName).toBe('OpenCode Agent');
    expect(copilot?.channelName).toBe('Copilot Agent');
  });
});

describe('updateConnectionId', () => {
  beforeEach(freshDb);

  it('updates the connection_id column for an existing row', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_for_update',
      providerType: 'opencode',
      channelName: 'Update Agent',
      projectName: 'proj',
    });

    updateConnectionId('ses_for_update', 'transport-uuid-456', 'opencode');

    const result = getRegisteredConnectionBySessionId(
      'ses_for_update',
      'opencode',
    );
    expect(result?.connectionId).toBe('transport-uuid-456');
  });

  it('allows secondary lookup by connection_id after updateConnectionId', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_bind_test',
      providerType: 'opencode',
      channelName: 'Bind Agent',
      projectName: 'proj',
    });

    updateConnectionId('ses_bind_test', 'uuid-transport-789', 'opencode');

    const byConnectionId = getRegisteredConnection('uuid-transport-789');
    expect(byConnectionId).not.toBeNull();
    expect(byConnectionId?.providerSessionId).toBe('ses_bind_test');
  });

  it('does not affect other rows when updating a specific session', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_one',
      providerType: 'opencode',
      channelName: 'Agent One',
      projectName: 'proj',
    });
    upsertRegisteredConnection({
      providerSessionId: 'ses_two',
      providerType: 'opencode',
      channelName: 'Agent Two',
      projectName: 'proj',
    });

    updateConnectionId('ses_one', 'conn-one-transport', 'opencode');

    const two = getRegisteredConnectionBySessionId('ses_two', 'opencode');
    expect(two?.connectionId).toBeNull();
  });
});

describe('upsertRegisteredConnection with composite primary key', () => {
  beforeEach(freshDb);

  it('inserts a row with (provider_type, provider_session_id) as primary key', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_pk_test',
      providerType: 'opencode',
      channelName: 'PK Agent',
      projectName: 'my-proj',
    });

    const all = getAllRegisteredConnections();
    expect(all).toHaveLength(1);
    expect(all[0].providerSessionId).toBe('ses_pk_test');
    expect(all[0].providerType).toBe('opencode');
  });

  it('updates the row on conflict with same composite key', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_conflict',
      providerType: 'opencode',
      channelName: 'Old Name',
      projectName: 'proj',
      connectionId: 'old-transport',
    });

    upsertRegisteredConnection({
      providerSessionId: 'ses_conflict',
      providerType: 'opencode',
      channelName: 'New Name',
      projectName: 'proj',
      connectionId: 'new-transport',
    });

    const all = getAllRegisteredConnections();
    expect(all).toHaveLength(1);
    expect(all[0].channelName).toBe('New Name');
    expect(all[0].connectionId).toBe('new-transport');
  });

  it('connectionId defaults to null when omitted', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_no_conn',
      providerType: 'opencode',
      channelName: 'Null Conn Agent',
      projectName: 'proj',
    });

    const result = getRegisteredConnectionBySessionId(
      'ses_no_conn',
      'opencode',
    );
    expect(result?.connectionId).toBeNull();
  });

  it('stores connectionId when provided', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_with_conn',
      providerType: 'opencode',
      channelName: 'With Conn Agent',
      projectName: 'proj',
      connectionId: 'explicit-transport-id',
    });

    const result = getRegisteredConnectionBySessionId(
      'ses_with_conn',
      'opencode',
    );
    expect(result?.connectionId).toBe('explicit-transport-id');
  });

  it('allows same providerSessionId with different providerTypes', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_same_id',
      providerType: 'opencode',
      channelName: 'OpenCode Agent',
      projectName: 'proj',
    });
    upsertRegisteredConnection({
      providerSessionId: 'ses_same_id',
      providerType: 'copilot-cli',
      channelName: 'Copilot Agent',
      projectName: 'proj',
    });

    const all = getAllRegisteredConnections();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.providerType)).toContain('opencode');
    expect(all.map((r) => r.providerType)).toContain('copilot-cli');
  });

  it('defaults providerType to standalone when omitted', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_default_type',
      channelName: 'Default Type Agent',
      projectName: 'proj',
    });

    const result = getRegisteredConnectionBySessionId(
      'ses_default_type',
      'standalone',
    );
    expect(result).not.toBeNull();
    expect(result?.providerType).toBe('standalone');
  });

  it('supports backwards compatibility with openCodeSessionId param', () => {
    upsertRegisteredConnection({
      openCodeSessionId: 'ses_compat',
      providerType: 'opencode',
      channelName: 'Compat Agent',
      projectName: 'proj',
    });

    const result = getRegisteredConnectionBySessionId('ses_compat', 'opencode');
    expect(result).not.toBeNull();
    expect(result?.providerSessionId).toBe('ses_compat');
  });
});

describe('getRegisteredConnection secondary lookup by connection_id', () => {
  beforeEach(freshDb);

  it('returns null when no row has the given connection_id', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_exists',
      providerType: 'opencode',
      channelName: 'Agent',
      projectName: 'proj',
    });

    const result = getRegisteredConnection('nonexistent-transport');
    expect(result).toBeNull();
  });

  it('finds row by connection_id column (secondary index lookup)', () => {
    upsertRegisteredConnection({
      providerSessionId: 'ses_secondary',
      providerType: 'opencode',
      channelName: 'Secondary Agent',
      projectName: 'proj',
      connectionId: 'transport-handle-abc',
    });

    const result = getRegisteredConnection('transport-handle-abc');
    expect(result).not.toBeNull();
    expect(result?.providerSessionId).toBe('ses_secondary');
  });

  it('returns the most recently updated row when multiple rows share the same connection_id', () => {
    // Parent agent registers first with shared transport
    upsertRegisteredConnection({
      providerSessionId: 'ses_parent',
      providerType: 'opencode',
      channelName: 'Parent Agent',
      projectName: 'proj',
      connectionId: 'shared-transport',
    });

    // Subagent registers later with the same transport connectionId
    upsertRegisteredConnection({
      providerSessionId: 'ses_subagent',
      providerType: 'opencode',
      channelName: 'Subagent',
      projectName: 'proj',
      connectionId: 'shared-transport',
    });

    const result = getRegisteredConnection('shared-transport');
    expect(result).not.toBeNull();
    // Should return the most recently updated row (subagent), not an arbitrary one
    expect(result?.providerSessionId).toBe('ses_subagent');
  });
});

// ─── Skills & Instructions with category/tags ─────────────────────────────────

describe('upsertSkillOrInstruction with category and tags', () => {
  beforeEach(freshDb);

  it('stores category when provided', () => {
    const result = upsertSkillOrInstruction({
      name: 'test-skill',
      type: 'skill',
      description: 'A test skill',
      content: '# Test',
      category: 'Code Review',
    });

    expect(result).not.toBeNull();
    expect(result?.category).toBe('Code Review');
  });

  it('stores tags as JSON array when provided', () => {
    const result = upsertSkillOrInstruction({
      name: 'test-skill-tags',
      type: 'skill',
      description: 'A skill with tags',
      content: '# Test',
      tags: ['typescript', 'react', 'testing'],
    });

    expect(result).not.toBeNull();
    expect(result?.tags).toEqual(['typescript', 'react', 'testing']);
  });

  it('allows null category and tags', () => {
    const result = upsertSkillOrInstruction({
      name: 'minimal-skill',
      type: 'skill',
      description: 'Minimal',
      content: '# Minimal',
    });

    expect(result).not.toBeNull();
    expect(result?.category).toBeNull();
    expect(result?.tags).toBeNull();
  });

  it('updates category and tags on upsert', () => {
    upsertSkillOrInstruction({
      name: 'update-skill',
      type: 'skill',
      description: 'Original',
      content: '# Original',
      category: 'Testing',
      tags: ['old-tag'],
    });

    const updated = upsertSkillOrInstruction({
      name: 'update-skill',
      type: 'skill',
      description: 'Updated',
      content: '# Updated',
      category: 'Documentation',
      tags: ['new-tag', 'another'],
    });

    expect(updated?.category).toBe('Documentation');
    expect(updated?.tags).toEqual(['new-tag', 'another']);
  });
});

describe('listSkillsAndInstructions with category filter', () => {
  beforeEach(freshDb);

  it('filters by category when provided', () => {
    upsertSkillOrInstruction({
      name: 'code-review-skill',
      type: 'skill',
      description: 'Code review',
      content: '# CR',
      category: 'Code Review',
    });
    upsertSkillOrInstruction({
      name: 'testing-skill',
      type: 'skill',
      description: 'Testing',
      content: '# Test',
      category: 'Testing',
    });
    upsertSkillOrInstruction({
      name: 'no-category-skill',
      type: 'skill',
      description: 'No category',
      content: '# NC',
    });

    const codeReviewItems = listSkillsAndInstructions(undefined, 'Code Review');
    expect(codeReviewItems).toHaveLength(1);
    expect(codeReviewItems[0].name).toBe('code-review-skill');

    const testingItems = listSkillsAndInstructions(undefined, 'Testing');
    expect(testingItems).toHaveLength(1);
    expect(testingItems[0].name).toBe('testing-skill');
  });

  it('returns all items when no category filter is provided', () => {
    upsertSkillOrInstruction({
      name: 'skill1',
      type: 'skill',
      description: 'S1',
      content: '#',
      category: 'Code Review',
    });
    upsertSkillOrInstruction({
      name: 'skill2',
      type: 'skill',
      description: 'S2',
      content: '#',
      category: 'Testing',
    });

    const all = listSkillsAndInstructions();
    expect(all).toHaveLength(2);
  });

  it('combines type and category filters', () => {
    upsertSkillOrInstruction({
      name: 'skill-cr',
      type: 'skill',
      description: 'Skill CR',
      content: '#',
      category: 'Code Review',
    });
    upsertSkillOrInstruction({
      name: 'instruction-cr',
      type: 'instruction',
      description: 'Instruction CR',
      content: '#',
      category: 'Code Review',
    });

    const skillsOnly = listSkillsAndInstructions('skill', 'Code Review');
    expect(skillsOnly).toHaveLength(1);
    expect(skillsOnly[0].name).toBe('skill-cr');
  });
});

describe('getSkillOrInstructionByName returns category and tags', () => {
  beforeEach(freshDb);

  it('returns the full record including category and tags', () => {
    upsertSkillOrInstruction({
      name: 'full-skill',
      type: 'skill',
      description: 'Full skill',
      content: '# Full',
      category: 'Workflow',
      tags: ['tag1', 'tag2'],
    });

    const result = getSkillOrInstructionByName('full-skill');
    expect(result).not.toBeNull();
    expect(result?.category).toBe('Workflow');
    expect(result?.tags).toEqual(['tag1', 'tag2']);
  });
});

describe('deleteSkillOrInstruction', () => {
  beforeEach(freshDb);

  it('deletes a skill with category and tags', () => {
    upsertSkillOrInstruction({
      name: 'to-delete',
      type: 'skill',
      description: 'Delete me',
      content: '#',
      category: 'Testing',
      tags: ['temp'],
    });

    const deleted = deleteSkillOrInstruction('to-delete');
    expect(deleted).toBe(true);

    const result = getSkillOrInstructionByName('to-delete');
    expect(result).toBeNull();
  });
});
