import { ChevronDown, Filter, Plus, Search, X } from 'lucide-react';
import type { Folder, SkillOrInstruction, TabType } from './skills-types';
import { SkillsTree } from './SkillsTree';
import { SkillsDndProvider } from './dnd/SkillsDndContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type SkillsSidebarProps = {
  tab: TabType;
  setTab: (tab: TabType) => void;
  search: string;
  setSearch: (search: string) => void;
  categoryFilter: string;
  setCategoryFilter: (category: string) => void;
  availableCategories: string[];
  unfiledEntries: SkillOrInstruction[];
  entriesByFolder: Record<number, SkillOrInstruction[]>;
  allCount: number;
  skillCount: number;
  instructionCount: number;
  selected: SkillOrInstruction | null;
  exportStatus: string | null;
  onExport: () => void;
  onCreate: () => void;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  // Folders
  folders: Folder[];
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number) => Promise<void>;
  onMoveEntry: (name: string, folderId: number | null) => void;
  hasActiveFilters: boolean;
};

export function SkillsSidebar({
  tab,
  setTab,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  availableCategories,
  unfiledEntries,
  entriesByFolder,
  allCount,
  skillCount,
  instructionCount,
  selected,
  exportStatus,
  onExport,
  onCreate,
  onSelect,
  onDelete,
  onToggleEnabled,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveEntry,
  hasActiveFilters,
}: SkillsSidebarProps): React.ReactElement {
  const handleClearFilters = (): void => {
    setSearch('');
    setCategoryFilter('');
  };

  return (
    <aside className="bg-background border-border flex w-72 shrink-0 flex-col border-r">
      {/* Header */}
      <div className="border-border space-y-3 border-b px-3 pt-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground truncate text-sm font-semibold">
              Skills &amp; Instructions
            </h2>
            <p className="text-muted-foreground text-xs">
              {allCount} {allCount === 1 ? 'item' : 'items'}
            </p>
          </div>

          {/* Split "+ New" button */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  New
                  <ChevronDown
                    className="h-3 w-3 opacity-70"
                    aria-hidden="true"
                  />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={onCreate}>New Skill</DropdownMenuItem>
              <DropdownMenuItem onClick={onCreate}>
                New Instruction
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onExport}>
                Export all as ZIP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabType)}
          className="w-full"
        >
          <TabsList className="grid h-8 w-full grid-cols-3">
            <TabsTrigger value="all" className="gap-1.5 text-xs">
              All
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] tabular-nums"
              >
                {allCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="skill" className="gap-1.5 text-xs">
              Skills
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] tabular-nums"
              >
                {skillCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="instruction" className="gap-1.5 text-xs">
              Instr.
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] tabular-nums"
              >
                {instructionCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Search + filter row */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearch(e.target.value)
              }
              placeholder="Search…"
              className="h-8 pl-7 text-xs"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 shrink-0 gap-1 px-2 text-xs',
                    categoryFilter && 'border-primary/40 text-primary',
                  )}
                  aria-label="Filter by category"
                >
                  <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                  {categoryFilter || 'All'}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem
                onClick={() => setCategoryFilter('')}
                className={cn(!categoryFilter && 'bg-accent')}
              >
                All categories
              </DropdownMenuItem>
              {availableCategories.length > 0 && <DropdownMenuSeparator />}
              {availableCategories.map((cat) => (
                <DropdownMenuItem
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(categoryFilter === cat && 'bg-accent')}
                >
                  {cat}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="text-muted-foreground hover:text-foreground h-6 w-full justify-start gap-1 px-2 text-xs"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear filters
          </Button>
        )}

        {exportStatus && (
          <p className="text-muted-foreground text-[11px]">{exportStatus}</p>
        )}
      </div>

      {/* DnD-wrapped scrollable folder list */}
      <SkillsDndProvider onDropEntryToFolder={onMoveEntry}>
        <SkillsTree
          folders={folders}
          unfiledEntries={unfiledEntries}
          entriesByFolder={entriesByFolder}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onToggleEnabled={onToggleEnabled}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onMoveEntry={onMoveEntry}
          emptyLabel={
            hasActiveFilters
              ? 'No matches for your filters.'
              : 'No entries yet. Click "+ New" to create one, or use the manage_skills_and_instructions tool from an agent.'
          }
        />
      </SkillsDndProvider>
    </aside>
  );
}
