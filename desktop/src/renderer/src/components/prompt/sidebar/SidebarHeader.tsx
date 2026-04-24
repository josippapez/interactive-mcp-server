import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ProviderFilter, PROVIDER_LABELS, PROVIDER_ICONS } from './types';

type SidebarHeaderProps = {
  filter: ProviderFilter;
  onFilterChange: (filter: ProviderFilter) => void;
  providerTabs: ProviderFilter[];
  providerCounts: Record<ProviderFilter, number>;
  showInactive: boolean;
  inactiveCount: number;
  onToggleInactive: () => void;
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
  showInactive,
  inactiveCount,
  onToggleInactive,
  isRefreshing,
  onRefresh,
}: SidebarHeaderProps): React.ReactElement {
  const inactiveLabel = showInactive
    ? 'Hide inactive'
    : inactiveCount > 0
      ? `Show inactive (${inactiveCount})`
      : 'Show inactive';

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/95">
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
              Sessions
            </p>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1">
            <Button
              variant="ghost"
              onClick={onToggleInactive}
              title={inactiveLabel}
              className={`h-7 shrink-0 px-2 text-[10px] ${
                showInactive
                  ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)] hover:bg-[var(--color-agent)]/20 hover:text-[var(--color-agent)]'
                  : 'text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
              }`}
            >
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh sessions"
              className="h-7 w-7 shrink-0 rounded-md text-[var(--color-text-faint)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
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

        <Tabs
          value={filter}
          onValueChange={(value) => onFilterChange(value as ProviderFilter)}
          className="w-full"
        >
          <TabsList className="flex h-auto w-full flex-wrap items-center justify-start gap-1 bg-transparent p-0">
            {providerTabs.map((provider) => (
              <TabsTrigger
                key={provider}
                value={provider}
                title={`Show ${PROVIDER_LABELS[provider]} sessions`}
                className="flex h-7 items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-[10px] font-normal whitespace-nowrap text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text-muted)] data-[state=active]:border-[var(--color-agent)]/20 data-[state=active]:bg-[var(--color-agent)]/15 data-[state=active]:text-[var(--color-agent)] data-[state=active]:shadow-none"
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
      </div>
    </div>
  );
});
