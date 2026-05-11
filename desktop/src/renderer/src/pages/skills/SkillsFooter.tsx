import { memo } from 'react';
import { cn } from '@/lib/utils';

type SkillsFooterProps = {
  visibleCount: number;
  folderCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
};

export const SkillsFooter = memo(function SkillsFooter({
  visibleCount,
  folderCount,
  hasActiveFilters,
  onClearFilters,
}: SkillsFooterProps): React.ReactElement {
  return (
    <div className="border-border flex h-6 shrink-0 items-center justify-between border-t px-2">
      <span className="text-muted-foreground text-[10px] tabular-nums">
        {visibleCount} {visibleCount === 1 ? 'item' : 'items'} · {folderCount}{' '}
        {folderCount === 1 ? 'folder' : 'folders'}
      </span>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className={cn(
            'text-muted-foreground hover:text-foreground rounded text-[10px] underline-offset-2 hover:underline',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          Filters on · clear
        </button>
      )}
    </div>
  );
});
