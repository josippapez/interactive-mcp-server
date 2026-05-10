import { describe, expect, it } from 'vitest';
import type { PendingPermission } from '../types';
import { getPermissionDisplay } from './permission-display';

function permission(input: Partial<PendingPermission>): PendingPermission {
  return {
    requestId: 'req_1',
    sessionID: 'ses_1',
    permission: 'read',
    ...input,
  };
}

describe('getPermissionDisplay', () => {
  it('uses edit metadata for the title and detail', () => {
    expect(
      getPermissionDisplay(
        permission({
          permission: 'edit',
          metadata: { filepath: '/repo/src/app.ts', diff: '--- old' },
        }),
      ),
    ).toEqual({ icon: '->', title: 'Edit app.ts', detail: '/repo/src/app.ts' });
  });

  it('uses search metadata for grep permissions', () => {
    expect(
      getPermissionDisplay(
        permission({
          permission: 'grep',
          metadata: { pattern: 'useEffect', include: '*.tsx' },
        }),
      ),
    ).toEqual({
      icon: '*',
      title: 'Grep "useEffect"',
      detail: 'include: *.tsx',
    });
  });
});
