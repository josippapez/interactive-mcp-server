import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock dependencies before importing the module under test.
vi.mock('../database', () => ({
  getRegisteredConnection: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(),
  upsertRegisteredConnection: vi.fn(),
}));

vi.mock('../opencode/session', () => ({
  autoDetectOpenCodeSession: vi.fn(),
}));

import {
  resolveSession,
  reResolveStaleSession,
  resolveProviderSessionId,
} from './resolver';
import {
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
  upsertRegisteredConnection,
} from '../database';
import { autoDetectOpenCodeSession } from '../opencode/session';

const mockGetConnection = getRegisteredConnection as Mock;
const mockGetConnectionBySessionId = getRegisteredConnectionBySessionId as Mock;
const mockUpsert = upsertRegisteredConnection as Mock;
const mockAutoDetect = autoDetectOpenCodeSession as Mock;

function makeConnection(
  overrides: Partial<{
    connectionId: string;
    channelName: string;
    projectName: string;
    baseDirectory: string | null;
    idFilePath: string;
    providerSessionId: string | null;
    parentSessionId: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {},
) {
  return {
    connectionId: overrides.connectionId ?? 'conn-uuid-1',
    channelName: overrides.channelName ?? 'Claude Code',
    projectName: overrides.projectName ?? 'my-project',
    baseDirectory:
      'baseDirectory' in overrides ? overrides.baseDirectory : '/repo',
    idFilePath: overrides.idFilePath ?? '/tmp/imcp-agent-1.json',
    providerSessionId:
      'providerSessionId' in overrides
        ? overrides.providerSessionId
        : 'ses_abc123',
    parentSessionId:
      'parentSessionId' in overrides ? overrides.parentSessionId : null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00Z',
  };
}

describe('resolveSession', () => {
  beforeEach(() => {
    mockGetConnection.mockReset();
    mockGetConnectionBySessionId.mockReset();
    mockUpsert.mockReset();
    mockAutoDetect.mockReset();
  });

  // ── Standalone mode ──────────────────────────────────────────────────

  it('returns "none" for standalone backend', async () => {
    const result = await resolveSession({
      connectionId: 'conn-1',
      backend: 'standalone',
    });
    expect(result.resolvedVia).toBe('none');
    expect(result.providerSessionId).toBeNull();
    expect(result.message).toContain('Standalone');
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  // ── No DB record ─────────────────────────────────────────────────────

  it('returns "none" when no DB record exists', async () => {
    mockGetConnection.mockReturnValue(null);

    const result = await resolveSession({
      connectionId: 'unknown-conn',
      backend: 'opencode',
      openCodePort: 1337,
    });
    expect(result.resolvedVia).toBe('none');
    expect(result.providerSessionId).toBeNull();
    expect(result.message).toContain('unknown-conn');
  });

  // ── OpenCode: cached path ────────────────────────────────────────────

  it('returns "cached" when DB has a non-null providerSessionId', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: 'ses_cached' }),
    );

    const result = await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });
    expect(result.resolvedVia).toBe('cached');
    expect(result.providerSessionId).toBe('ses_cached');
    expect(result.parentSessionId).toBeNull();
    expect(mockAutoDetect).not.toHaveBeenCalled();
  });

  it('returns parentSessionId from cached DB record', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({
        providerSessionId: 'ses_child',
        parentSessionId: 'ses_parent',
      }),
    );

    const result = await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });
    expect(result.resolvedVia).toBe('cached');
    expect(result.providerSessionId).toBe('ses_child');
    expect(result.parentSessionId).toBe('ses_parent');
  });

  // ── OpenCode: re-resolve path ────────────────────────────────────────

  it('re-resolves when providerSessionId is null and OpenCode API returns a session', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: null }),
    );
    mockAutoDetect.mockResolvedValue({ id: 'ses_new', parentId: null });

    const result = await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });

    expect(result.resolvedVia).toBe('re-resolved');
    expect(result.providerSessionId).toBe('ses_new');
    expect(result.parentSessionId).toBeNull();

    // Should have updated the DB with the new session ID.
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-uuid-1',
        providerSessionId: 'ses_new',
      }),
    );
  });

  it('uses baseDirectory from opts when provided for re-resolve', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: null, baseDirectory: '/old' }),
    );
    mockAutoDetect.mockResolvedValue({ id: 'ses_x', parentId: null });

    await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
      baseDirectory: '/override',
    });

    expect(mockAutoDetect).toHaveBeenCalledWith(1337, '/override');
  });

  it('falls back to DB baseDirectory for re-resolve when opts.baseDirectory is absent', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({
        providerSessionId: null,
        baseDirectory: '/from-db',
      }),
    );
    mockAutoDetect.mockResolvedValue({ id: 'ses_y', parentId: null });

    await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });

    expect(mockAutoDetect).toHaveBeenCalledWith(1337, '/from-db');
  });

  // ── OpenCode: re-resolve failures ────────────────────────────────────

  it('returns "none" when no OpenCode port is configured', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: null }),
    );

    const result = await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      // no openCodePort
    });

    expect(result.resolvedVia).toBe('none');
    expect(result.message).toContain('No OpenCode port');
    expect(mockAutoDetect).not.toHaveBeenCalled();
  });

  it('returns "none" when OpenCode API is unreachable', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: null }),
    );
    mockAutoDetect.mockResolvedValue(null);

    const result = await resolveSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });

    expect(result.resolvedVia).toBe('none');
    expect(result.message).toContain('unreachable');
  });

  // ── Claude SDK resolution ────────────────────────────────────────────

  it('returns connectionId as providerSessionId for Claude SDK', async () => {
    mockGetConnection.mockReturnValue(
      makeConnection({
        connectionId: 'conn-claude-1',
        providerSessionId: null,
      }),
    );

    const result = await resolveSession({
      connectionId: 'conn-claude-1',
      backend: 'claude_sdk',
    });

    expect(result.resolvedVia).toBe('cached');
    expect(result.providerSessionId).toBe('conn-claude-1');
    expect(mockAutoDetect).not.toHaveBeenCalled();
  });

  // ── Unsupported backend ──────────────────────────────────────────────

  it('returns "none" for unsupported backend', async () => {
    mockGetConnection.mockReturnValue(makeConnection());

    const result = await resolveSession({
      connectionId: 'conn-1',
      backend: 'unknown_backend' as 'opencode',
    });

    expect(result.resolvedVia).toBe('none');
    expect(result.message).toContain('Unsupported');
  });
});

describe('reResolveStaleSession', () => {
  beforeEach(() => {
    mockGetConnection.mockReset();
    mockUpsert.mockReset();
    mockAutoDetect.mockReset();
  });

  it('delegates to resolveSession and returns cached result when session exists', async () => {
    // With providerSessionId as PK (Phase 2 schema), reResolveStaleSession
    // no longer clears the cached session ID — it simply delegates to
    // resolveSession. The session ID IS the primary key; you cannot null it out.
    mockGetConnection.mockReturnValueOnce(
      makeConnection({ providerSessionId: 'ses_existing' }),
    );

    const result = await reResolveStaleSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });

    // No DB upsert — the session ID is already set, nothing to clear or update.
    expect(mockUpsert).not.toHaveBeenCalled();

    expect(result.resolvedVia).toBe('cached');
    expect(result.providerSessionId).toBe('ses_existing');
  });

  it('handles case where no DB record exists (no-op clear)', async () => {
    mockGetConnection.mockReturnValue(null);

    const result = await reResolveStaleSession({
      connectionId: 'missing-conn',
      backend: 'opencode',
      openCodePort: 1337,
    });

    expect(result.resolvedVia).toBe('none');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips clear if providerSessionId is already null', async () => {
    // Both calls return the same record with null session.
    mockGetConnection.mockReturnValue(
      makeConnection({ providerSessionId: null }),
    );
    mockAutoDetect.mockResolvedValue({ id: 'ses_new', parentId: 'ses_p' });

    const result = await reResolveStaleSession({
      connectionId: 'conn-uuid-1',
      backend: 'opencode',
      openCodePort: 1337,
    });

    // The first upsert call should be from resolveSession (not from clear).
    // reResolveStaleSession should NOT have called upsert to clear (session was already null).
    // resolveSession should call upsert once with the new session.
    const upsertCalls = mockUpsert.mock.calls;
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0][0]).toEqual(
      expect.objectContaining({
        providerSessionId: 'ses_new',
      }),
    );

    expect(result.resolvedVia).toBe('re-resolved');
    expect(result.providerSessionId).toBe('ses_new');
    expect(result.parentSessionId).toBe('ses_p');
  });
});
