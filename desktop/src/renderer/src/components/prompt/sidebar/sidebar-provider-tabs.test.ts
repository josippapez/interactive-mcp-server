import { describe, expect, it } from 'vitest';
import { shouldShowProviderTabs } from './sidebar-provider-tabs';

describe('shouldShowProviderTabs', () => {
  it('hides provider tabs when all sessions are OpenCode', () => {
    expect(shouldShowProviderTabs(['all'])).toBe(false);
    expect(shouldShowProviderTabs(['all', 'opencode'])).toBe(false);
  });

  it('shows provider tabs when another provider is present', () => {
    expect(shouldShowProviderTabs(['all', 'opencode', 'standalone'])).toBe(
      true,
    );
  });
});
