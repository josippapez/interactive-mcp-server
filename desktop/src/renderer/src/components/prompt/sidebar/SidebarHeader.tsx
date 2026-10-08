import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ProviderFilter, PROVIDER_LABELS, PROVIDER_ICONS } from './types';
import { shouldShowProviderTabs } from './sidebar-provider-tabs';

type SidebarHeaderProps = {
  filter: ProviderFilter;
  onFilterChange: (filter: ProviderFilter) => void;
  providerTabs: ProviderFilter[];
  providerCounts: Record<ProviderFilter, number>;
  showArchived: boolean;
  onToggleArchived: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
};

/**
 * Sidebar header with provider filter tabs and refresh button.
 */
export const SidebarHeader = memo(function SidebarHeader({
  filter,
  onFilterChange,
  providerTabs,
  providerCounts,
  showArchived,
  onToggleArchived,
  isRefreshing,
  onRefresh,
}: SidebarHeaderProps): React.ReactElement {
  const showProviderTabs = shouldShowProviderTabs(providerTabs);

  return (
    <div className="border-b border-[var(--color-border-weak)]">
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="section-label !px-0 !py-0">Sessions</span>
          <div className="flex min-w-0 items-center justify-end gap-1">
            <Button
              variant="ghost"
              onClick={onToggleArchived}
              title={
                showArchived ? 'Show active sessions' : 'View archived sessions'
              }
              className={`h-6 shrink-0 rounded-full px-2 text-[10px] ${
                showArchived
                  ? 'bg-[color-mix(in_srgb,var(--color-agent)_15%,transparent)] text-[var(--color-agent)] hover:bg-[color-mix(in_srgb,var(--color-agent)_22%,transparent)] hover:text-[var(--color-agent)]'
                  : 'text-[var(--color-text-faint)] hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] hover:text-[var(--color-text)]'
              }`}
            >
              {showArchived ? 'Archived' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh sessions"
              className="h-6 w-6 shrink-0 rounded-full text-[var(--color-text-faint)] hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] hover:text-[var(--color-text)]"
              aria-label="Refresh sessions"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isRefreshing ? 'animate-spin' : ''}
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </Button>
          </div>
        </div>

        {showProviderTabs && (
          <Tabs
            value={filter}
            onValueChange={(value: string) =>
              onFilterChange(value as ProviderFilter)
            }
            className="w-full"
          >
            <TabsList className="flex h-auto w-full flex-wrap items-center justify-start gap-1 bg-transparent p-0">
              {providerTabs.map((provider) => (
                <TabsTrigger
                  key={provider}
                  value={provider}
                  title={`Show ${PROVIDER_LABELS[provider]} sessions`}
                  className="flex h-6 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[10px] font-normal whitespace-nowrap text-[var(--color-text-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] hover:text-[var(--color-text-muted)] data-[state=active]:border-[color-mix(in_srgb,var(--color-agent)_22%,transparent)] data-[state=active]:bg-[color-mix(in_srgb,var(--color-agent)_15%,transparent)] data-[state=active]:text-[var(--color-agent)] data-[state=active]:shadow-none"
                >
                  <span>{PROVIDER_ICONS[provider]}</span>
                  <span>{PROVIDER_LABELS[provider]}</span>
                  <span className="text-[9px] opacity-60">
                    ({providerCounts[provider]})
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>
    </div>
  );
});
