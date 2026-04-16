import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetPermissionClientFactory,
  _setPermissionClientFactory,
  replyToOpenCodePermission,
} from './permission-reply';

const mocks = vi.hoisted(() => ({
  getRegisteredConnectionBySessionId: vi.fn(() => null),
}));

vi.mock('../database', () => ({
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
}));

describe('replyToOpenCodePermission', () => {
  beforeEach(() => {
    _resetPermissionClientFactory();
    vi.clearAllMocks();
  });

  it('uses the registered baseDirectory as client scope when available', async () => {
    const replyMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    mocks.getRegisteredConnectionBySessionId.mockReturnValue({
      baseDirectory: '/repo',
    });

    _setPermissionClientFactory((_port, directory) => {
      expect(directory).toBe('/repo');
      return {
        permission: {
          reply: replyMock,
        },
      } as never;
    });

    const result = await replyToOpenCodePermission(
      4096,
      'ses-123',
      'req-1',
      'once',
    );

    expect(result).toEqual({ ok: true });
    expect(replyMock).toHaveBeenCalledWith({
      requestID: 'req-1',
      reply: 'once',
      directory: '/repo',
    });
  });
});
