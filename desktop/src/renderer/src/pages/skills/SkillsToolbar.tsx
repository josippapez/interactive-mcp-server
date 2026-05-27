import { memo, useCallback, useRef, useState } from 'react';
import { Filter, Search, X, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { TabType } from './skills-types';

type SkillsToolbarProps = {
  search: string;
  setSearch: (s: string) => void;
  tab: TabType;
  setTab: (t: TabType) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  availableCategories: string[];
  hasActiveFilters: boolean;
  onExport: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
};

export const SkillsToolbar = memo(function SkillsToolbar({
  search,
  setSearch,
  tab,
  setTab,
  categoryFilter,
  setCategoryFilter,
  availableCategories,
  hasActiveFilters,
  onExport,
  onCollapseAll,
  onExpandAll,
}: SkillsToolbarProps): React.ReactElement {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const expandSearch = useCallback(() => {
    setSearchExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const collapseSearch = useCallback(() => {
    if (!search) {
      setSearchExpanded(false);
    }
  }, [search]);

  const clearSearch = useCallback(() => {
    setSearch('');
    setSearchExpanded(false);
  }, [setSearch]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        clearSearch();
      }
    },
    [clearSearch],
  );

  const handleSidebarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        expandSearch();
      }
    },
    [expandSearch],
  );

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setCategoryFilter('');
    setTab('all');
  }, [setSearch, setCategoryFilter, setTab]);

  const isSearchVisible = searchExpanded || Boolean(search);

  return (
    <div
      className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-2"
      onKeyDown={handleSidebarKeyDown}
    >
      {isSearchVisible ? (
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="text-muted-foreground pointer-events-none absolute left-1.5 h-3.5 w-3.5"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(e.target.value)
            }
            onKeyDown={handleSearchKeyDown}
            onBlur={collapseSearch}
            placeholder="Search…"
            className="h-6 w-full border-0 bg-transparent pl-6 pr-6 text-xs shadow-none focus-visible:ring-0"
            aria-label="Search skills and instructions"
          />
          {search && (
            <button
              type="button"
              onClick={clearSearch}
              className="text-muted-foreground hover:text-foreground absolute right-1 flex h-4 w-4 items-center justify-center rounded"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={expandSearch}
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'relative h-6 w-6',
                  hasActiveFilters && 'text-primary',
                )}
                aria-label="Filter"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                {hasActiveFilters && (
                  <span
                    className="bg-primary absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
                    aria-hidden="true"
                  />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem
              onClick={() => setTab('all')}
              className={cn(tab === 'all' && 'font-medium')}
            >
              All types
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTab('skill')}
              className={cn(tab === 'skill' && 'font-medium')}
            >
              Skills only
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTab('instruction')}
              className={cn(tab === 'instruction' && 'font-medium')}
            >
              Instructions only
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setCategoryFilter('')}
              className={cn(!categoryFilter && 'font-medium')}
            >
              All categories
            </DropdownMenuItem>
            {availableCategories.map((cat) => (
              <DropdownMenuItem
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(categoryFilter === cat && 'font-medium')}
              >
                {cat}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleClearFilters}
              disabled={!hasActiveFilters}
              className="text-muted-foreground"
            >
              Clear filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={onExport}>Export ZIP</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCollapseAll}>
              Collapse all
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExpandAll}>
              Expand all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
