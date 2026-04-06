import { describe, expect, it, vi } from 'vitest';
import { removePersistedSession } from './remove-persisted-session';

describe('removePersistedSession', () => {
  it('applies the full persisted-session cleanup flow', () => {
    const send = vi.fn();
    const forceTerminateChat = vi.fn();
    const closeSessionByConnectionId = vi.fn().mockResolvedValue(true);
    const deleteSessionChannel = vi.fn();
    const deleteRegisteredConnection = vi.fn();
    const markConnectionDeleted = vi.fn();
    const triggerSessionTreeUpdate = vi.fn();

    const result = removePersistedSession('conn-123', {
      getWindow: () => ({ webContents: { send } }) as never,
      getOpenCodePort: () => 4096,
      forceTerminateChat,
      closeSessionByConnectionId,
      deleteSessionChannel,
      deleteRegisteredConnection,
      markConnectionDeleted,
      triggerSessionTreeUpdate,
    });

    expect(result).toBe(true);
    expect(forceTerminateChat).toHaveBeenCalledWith('conn-123');
    expect(closeSessionByConnectionId).toHaveBeenCalledWith('conn-123');
    expect(deleteSessionChannel).toHaveBeenCalledWith('conn-123');
    expect(deleteRegisteredConnection).toHaveBeenCalledWith('conn-123');
    expect(markConnectionDeleted).toHaveBeenCalledWith('conn-123');
    expect(triggerSessionTreeUpdate).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('connection-closed', {
      connectionId: 'conn-123',
    });
    expect(send).toHaveBeenCalledWith('session-channel-deleted', {
      sessionId: 'conn-123',
    });
  });
});
