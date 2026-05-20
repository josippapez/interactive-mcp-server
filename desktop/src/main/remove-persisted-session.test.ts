import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level mocks for side-effecting imports inside remove-persisted-session.ts.
vi.mock('./attachment-store', () => ({
  clearSessionAttachments: vi.fn(),
}));
vi.mock('./utility/backend/renderer-emit', () => ({
  emitToRenderer: vi.fn(),
}));

import { emitToRenderer } from './utility/backend/renderer-emit';
import { removePersistedSession } from './remove-persisted-session';
import type { RemovePersistedSessionDeps } from './remove-persisted-session';

type Deps = RemovePersistedSessionDeps;

function makeDeps(overrides: Partial<Deps> = {}): {
  deps: Deps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: Deps = {
    getOpenCodePort: () => 12345,
    deleteOpenCodeSession: vi.fn(async () => {
      calls.push('deleteOpenCodeSession');
    }),
    forceTerminateChat: vi.fn(() => {
      calls.push('forceTerminateChat');
    }),
    closeSessionByConnectionId: vi.fn(async () => {
      calls.push('closeSessionByConnectionId');
      return true;
    }),
    deleteSessionChannel: vi.fn(async () => {
      calls.push('deleteSessionChannel');
    }),
    deleteRegisteredConnection: vi.fn(async () => {
      calls.push('deleteRegisteredConnection');
    }),
    markSessionDeleted: vi.fn(async () => {
      calls.push('markSessionDeleted');
    }),
    invalidate: vi.fn(() => {
      calls.push('invalidate');
    }),
    getRegisteredConnection: vi.fn(async () => ({
      providerSessionId: 'ses_abc123',
      providerType: 'opencode',
    })),
    tombstoneOpenCodeSession: vi.fn(async () => {
      calls.push('tombstoneOpenCodeSession');
    }),
    ...overrides,
  };
  return { deps, calls };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  vi.clearAllMocks();
});

describe('removePersistedSession — OpenCode delete integration', () => {
  it('OpenCode session, port available: calls deleteOpenCodeSession once with providerSessionId, local cleanup still runs in order', async () => {
    const { deps, calls } = makeDeps();

    await removePersistedSession('ses_abc123', deps);

    expect(deps.deleteOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(deps.deleteOpenCodeSession).toHaveBeenCalledWith(
      'ses_abc123',
      12345,
    );
    // Order: markSessionDeleted -> deleteOpenCodeSession -> tombstoneOpenCodeSession
    const idxMark = calls.indexOf('markSessionDeleted');
    const idxDelete = calls.indexOf('deleteOpenCodeSession');
    const idxTomb = calls.indexOf('tombstoneOpenCodeSession');
    expect(idxMark).toBeGreaterThanOrEqual(0);
    expect(idxDelete).toBeGreaterThan(idxMark);
    expect(idxTomb).toBeGreaterThan(idxDelete);
    expect(deps.tombstoneOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(deps.deleteSessionChannel).toHaveBeenCalledTimes(1);
    expect(deps.deleteRegisteredConnection).toHaveBeenCalledTimes(1);
  });

  it('OpenCode session, deleteOpenCodeSession throws: warning logged, local cleanup still completes', async () => {
    const { deps } = makeDeps({
      deleteOpenCodeSession: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(
      removePersistedSession('ses_abc123', deps),
    ).resolves.toBeDefined();

    expect(deps.deleteOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    // All local cleanup still ran.
    expect(deps.deleteSessionChannel).toHaveBeenCalledTimes(1);
    expect(deps.deleteRegisteredConnection).toHaveBeenCalledTimes(1);
    expect(deps.markSessionDeleted).toHaveBeenCalledTimes(1);
    expect(deps.tombstoneOpenCodeSession).toHaveBeenCalledTimes(1);
  });

  it('Non-OpenCode session (claude-sdk): does NOT call deleteOpenCodeSession', async () => {
    const { deps } = makeDeps({
      getRegisteredConnection: vi.fn(async () => ({
        providerSessionId: 'conn-uuid',
        providerType: 'claude-sdk',
      })),
    });

    await removePersistedSession('conn-uuid', deps);

    expect(deps.deleteOpenCodeSession).not.toHaveBeenCalled();
    // Local cleanup still happens.
    expect(deps.deleteSessionChannel).toHaveBeenCalledTimes(1);
    expect(deps.markSessionDeleted).toHaveBeenCalledTimes(1);
  });

  it('OpenCode session, port is null: does NOT call deleteOpenCodeSession; warning logged', async () => {
    const { deps } = makeDeps({
      getOpenCodePort: () => null,
    });

    await removePersistedSession('ses_abc123', deps);

    expect(deps.deleteOpenCodeSession).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    // Local cleanup still runs.
    expect(deps.deleteSessionChannel).toHaveBeenCalledTimes(1);
    expect(deps.markSessionDeleted).toHaveBeenCalledTimes(1);
  });

  it('No registered connection but sessionId matches /^ses_/: defaults to OpenCode and call IS made', async () => {
    const { deps } = makeDeps({
      getRegisteredConnection: vi.fn(async () => null),
    });

    await removePersistedSession('ses_orphan999', deps);

    expect(deps.deleteOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(deps.deleteOpenCodeSession).toHaveBeenCalledWith(
      'ses_orphan999',
      12345,
    );
  });

  it('No registered connection, sessionId does NOT match /^ses_/: call is NOT made', async () => {
    const { deps } = makeDeps({
      getRegisteredConnection: vi.fn(async () => null),
    });

    await removePersistedSession('some-uuid-not-opencode', deps);

    expect(deps.deleteOpenCodeSession).not.toHaveBeenCalled();
  });

  it('deletes and emits both connectionId and providerSessionId when they differ', async () => {
    const { deps } = makeDeps({
      getRegisteredConnection: vi.fn(async () => ({
        providerSessionId: 'ses_provider123',
        providerType: 'opencode',
      })),
    });

    await removePersistedSession('conn_transport456', deps);

    expect(deps.deleteSessionChannel).toHaveBeenCalledWith('conn_transport456');
    expect(deps.deleteSessionChannel).toHaveBeenCalledWith('ses_provider123');
    expect(emitToRenderer).toHaveBeenCalledWith('session-channel-deleted', {
      sessionId: 'conn_transport456',
    });
    expect(emitToRenderer).toHaveBeenCalledWith('session-channel-deleted', {
      sessionId: 'ses_provider123',
    });
  });
});
