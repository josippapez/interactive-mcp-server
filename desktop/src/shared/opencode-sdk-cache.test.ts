import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetClientFactory,
  _setClientFactory,
  getClient,
} from './opencode-sdk-cache';

describe('OpenCode SDK client cache', () => {
  beforeEach(() => {
    _resetClientFactory();
  });

  it('keys cached clients by directory and experimental workspace id', () => {
    const factory = vi.fn(
      (port: number, directory: string, workspaceId: string) => ({
        port,
        directory,
        workspaceId,
      }),
    );
    _setClientFactory(factory as never);

    const first = getClient(4096, '/repo', 'workspace-a');
    const again = getClient(4096, '/repo', 'workspace-a');
    const otherWorkspace = getClient(4096, '/repo', 'workspace-b');

    expect(first).toBe(again);
    expect(otherWorkspace).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, 4096, '/repo', 'workspace-a');
    expect(factory).toHaveBeenNthCalledWith(2, 4096, '/repo', 'workspace-b');
  });
});
