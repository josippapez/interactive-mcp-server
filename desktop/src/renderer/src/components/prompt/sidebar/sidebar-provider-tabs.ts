import type { ProviderFilter } from './types';

export function shouldShowProviderTabs(
  providerTabs: readonly ProviderFilter[],
): boolean {
  return providerTabs.some(
    (provider) => provider !== 'all' && provider !== 'opencode',
  );
}
