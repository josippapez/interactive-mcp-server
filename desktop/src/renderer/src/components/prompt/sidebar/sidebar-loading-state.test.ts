import { describe, expect, it } from 'vitest';
import { shouldShowSessionSkeleton } from './sidebar-loading-state';

describe('shouldShowSessionSkeleton', () => {
  it('shows skeletons while an empty session list is loading', () => {
    expect(
      shouldShowSessionSkeleton({
        isLoadingSessions: true,
        projectCount: 0,
        hasDirectConnections: false,
      }),
    ).toBe(true);
  });

  it('keeps existing projects visible during refreshes', () => {
    expect(
      shouldShowSessionSkeleton({
        isLoadingSessions: true,
        projectCount: 1,
        hasDirectConnections: false,
      }),
    ).toBe(false);
  });

  it('does not replace direct connections with session skeletons', () => {
    expect(
      shouldShowSessionSkeleton({
        isLoadingSessions: true,
        projectCount: 0,
        hasDirectConnections: true,
      }),
    ).toBe(false);
  });
});
