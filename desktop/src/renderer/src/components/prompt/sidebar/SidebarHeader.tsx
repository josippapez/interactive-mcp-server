import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ProviderFilter, PROVIDER_LABELS, PROVIDER_ICONS } from './types';

type SidebarHeaderProps = {
  filter: ProviderFilter;
  onFilterChange: (filter: ProviderFilter) => void;
  providerTabs: ProviderFilter[];
  providerCounts: Record<ProviderFilter, number>;
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
  isRefreshing,
  onRefresh,
}: SidebarHeaderProps): React.ReactElement {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center px-2 py-1.5 gap-1">
        <Tabs
          value={filter}
          onValueChange={(value) => onFilterChange(value as ProviderFilter)}
          className="flex-1 overflow-x-auto scrollbar-none"
        >
          <TabsList className="inline-flex h-7 items-center justify-start gap-1 bg-transparent p-0">
            {providerTabs.map((provider) => (
              <TabsTrigger
                key={provider}
                value={provider}
                title={`Show ${PROVIDER_LABELS[provider]} sessions`}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-sm transition-colors whitespace-nowrap data-[state=active]:bg-[var(--color-agent)]/15 data-[state=active]:text-[var(--color-agent)] data-[state=active]:shadow-none text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-border)] h-auto font-normal"
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
        {/* Refresh button - always visible */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh sessions"
          className="h-7 w-7 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] shrink-0"
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
  );
});
