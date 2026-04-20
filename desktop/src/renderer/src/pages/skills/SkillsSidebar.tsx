import type { Folder, SkillOrInstruction, TabType } from './skills-types';
import { SkillsTree } from './SkillsTree';
import { Input } from '@/components/ui/input';

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
  return (
    <aside className="w-64 border-r border-[var(--color-border)] flex flex-col shrink-0">
      {/* Header: title row + action buttons row */}
      <div className="px-3 pt-3 pb-2 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-medium text-[var(--color-text)] mb-1.5">
          Skills &amp; Instructions
        </h2>
        <div className="flex items-center justify-end gap-1 mb-2">
          <button
            type="button"
            onClick={onExport}
            title="Export all as ZIP"
            className="px-2.5 py-1 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
          >
            Export all
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="px-2.5 py-1 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
          >
            + New
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 mb-2">
          {(
            [
              { key: 'all', label: 'All', count: allCount },
              { key: 'skill', label: 'Skills', count: skillCount },
              {
                key: 'instruction',
                label: 'Instructions',
                count: instructionCount,
              },
            ] as { key: TabType; label: string; count: number }[]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[10px] rounded-sm transition-colors cursor-pointer ${
                tab === key
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]'
                  : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50'
              }`}
            >
              {label}
              <span
                className={`text-[9px] px-1 rounded-full ${
                  tab === key
                    ? 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                    : 'text-[var(--color-text-faint)]'
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Category filter dropdown */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-full mb-2 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-xs text-[var(--color-text)]"
        >
          <option value="">All Categories</option>
          {availableCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Search input */}
        <Input
          type="search"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
          placeholder="Search…"
          className="h-7 px-2 py-1 text-xs"
        />

        {exportStatus && (
          <p className="mt-1.5 text-[10px] text-[var(--color-text-faint)]">
            {exportStatus}
          </p>
        )}
      </div>

      {/* Tree: unfiled at root, folders with nested children */}
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
            ? 'No matches.'
            : 'No entries yet. Click "+ New" to create one, or use the manage_skills_and_instructions tool from an agent.'
        }
      />
    </aside>
  );
}
