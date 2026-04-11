import { describe, expect, it, vi } from 'vitest';
import { removePersistedSession } from './remove-persisted-session';
import type { RemovePersistedSessionDeps } from './remove-persisted-session';

describe('removePersistedSession', () => {
  const makeDeps = (overrides?: {
    closeSessionByConnectionId?: (id: string) => Promise<boolean>;
    registeredConnection?: { openCodeSessionId: string | null } | null;
  }) => {
    const send = vi.fn();
    const deps: RemovePersistedSessionDeps = {
      getWindow: () => ({ webContents: { send } }) as never,
      getOpenCodePort: () => 4096,
      forceTerminateChat: vi.fn(),
      closeSessionByConnectionId:
        overrides?.closeSessionByConnectionId ??
        vi.fn().mockResolvedValue(true),
      deleteSessionChannel: vi.fn(),
      deleteRegisteredConnection: vi.fn(),
      markConnectionDeleted: vi.fn(),
      triggerSessionTreeUpdate: vi.fn(),
      getRegisteredConnection: vi
        .fn()
        .mockReturnValue(
          overrides?.registeredConnection !== undefined
            ? overrides.registeredConnection
            : { openCodeSessionId: 'oc-session-123' },
        ),
      tombstoneOpenCodeSession: vi.fn(),
    };
    return { send, deps };
  };

  it('applies the full cleanup flow and returns true when closeSession succeeds', async () => {
    const { send, deps } = makeDeps();
    const result = await removePersistedSession('conn-123', deps);

    expect(result).toBe(true);
    expect(deps.forceTerminateChat).toHaveBeenCalledWith('conn-123');
    expect(deps.closeSessionByConnectionId).toHaveBeenCalledWith('conn-123');
    expect(deps.deleteSessionChannel).toHaveBeenCalledWith('conn-123');
    // deleteRegisteredConnection now takes the openCodeSessionId (PK), not connectionId
    expect(deps.deleteRegisteredConnection).toHaveBeenCalledWith(
      'oc-session-123',
    );
    expect(deps.markConnectionDeleted).toHaveBeenCalledWith('conn-123');
    expect(deps.triggerSessionTreeUpdate).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('connection-closed', {
      connectionId: 'conn-123',
    });
    expect(send).toHaveBeenCalledWith('session-channel-deleted', {
      sessionId: 'conn-123',
    });
  });

  it('tombstones the openCodeSessionId from the registered connection record', async () => {
    const { deps } = makeDeps({
      registeredConnection: { openCodeSessionId: 'oc-session-abc' },
    });
    await removePersistedSession('conn-123', deps);

    expect(deps.getRegisteredConnection).toHaveBeenCalledWith('conn-123');
    expect(deps.tombstoneOpenCodeSession).toHaveBeenCalledWith(
      'oc-session-abc',
    );
  });

  it('falls back to tombstoning sessionId itself when no registered connection exists', async () => {
    // This handles sessions that were never registered (only an OpenCode session
    // exists) — the caller passes the openCodeSessionId directly.
    const { deps } = makeDeps({ registeredConnection: null });
    await removePersistedSession('oc-session-xyz', deps);

    expect(deps.tombstoneOpenCodeSession).toHaveBeenCalledWith(
      'oc-session-xyz',
    );
  });

  it('falls back to tombstoning sessionId when the registered connection has no openCodeSessionId', async () => {
    const { deps } = makeDeps({
      registeredConnection: { openCodeSessionId: null },
    });
    await removePersistedSession('conn-no-oc', deps);

    // openCodeSessionId is null → fall back to sessionId
    expect(deps.tombstoneOpenCodeSession).toHaveBeenCalledWith('conn-no-oc');
  });

  it('returns false but still runs DB cleanup when closeSession returns false', async () => {
    const { deps } = makeDeps({
      closeSessionByConnectionId: vi.fn().mockResolvedValue(false),
    });

    const result = await removePersistedSession('conn-fail', deps);

    expect(result).toBe(false);
    // DB cleanup must still run despite the failed close
    expect(deps.deleteSessionChannel).toHaveBeenCalledWith('conn-fail');
    // deleteRegisteredConnection takes the openCodeSessionId (PK), not connectionId
    expect(deps.deleteRegisteredConnection).toHaveBeenCalledWith(
      'oc-session-123',
    );
    expect(deps.markConnectionDeleted).toHaveBeenCalledWith('conn-fail');
  });

  it('returns false but still runs DB cleanup when closeSession throws', async () => {
    const { deps } = makeDeps({
      closeSessionByConnectionId: vi
        .fn()
        .mockRejectedValue(new Error('transport closed')),
    });

    const result = await removePersistedSession('conn-throw', deps);

    expect(result).toBe(false);
    expect(deps.deleteSessionChannel).toHaveBeenCalledWith('conn-throw');
    // deleteRegisteredConnection takes the openCodeSessionId (PK), not connectionId
    expect(deps.deleteRegisteredConnection).toHaveBeenCalledWith(
      'oc-session-123',
    );
    expect(deps.markConnectionDeleted).toHaveBeenCalledWith('conn-throw');
  });

  it('sends IPC events regardless of closeSession outcome', async () => {
    const { send, deps } = makeDeps({
      closeSessionByConnectionId: vi.fn().mockRejectedValue(new Error('err')),
    });

    await removePersistedSession('conn-ipc', deps);

    expect(send).toHaveBeenCalledWith('connection-closed', {
      connectionId: 'conn-ipc',
    });
    expect(send).toHaveBeenCalledWith('session-channel-deleted', {
      sessionId: 'conn-ipc',
    });
  });
});
