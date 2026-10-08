import { describe, expect, it } from 'vitest';
import { getPermissionActions } from './permission-actions';

describe('getPermissionActions', () => {
  it('matches OpenCode permission action order and labels', () => {
    expect(getPermissionActions()).toEqual([
      { action: 'reject', label: 'Deny', variant: 'ghost' },
      { action: 'always', label: 'Allow Always', variant: 'outline' },
      { action: 'once', label: 'Allow Once', variant: 'default' },
    ]);
  });
});
