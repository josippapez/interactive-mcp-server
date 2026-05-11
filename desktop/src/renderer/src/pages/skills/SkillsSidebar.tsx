import { memo, useCallback, useState } from 'react';
import type { Folder, SkillOrInstruction, TabType } from './skills-types';
import { SkillsTree } from './SkillsTree';
import { SkillsToolbar } from './SkillsToolbar';
import { SkillsActionBar } from './SkillsActionBar';
import { SkillsFooter } from './SkillsFooter';
import { SkillsDndProvider } from './dnd/SkillsDndContext';
import { useResizableSidebar } from './useResizableSidebar';
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
  onCreateSkill: () => void;
  onCreateInstruction: () => void;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  folders: Folder[];
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number) => void;
  onMoveEntry: (name: string, folderId: number | null) => void;
  hasActiveFilters: boolean;
};

export const SkillsSidebar = memo(function SkillsSidebar({
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
  selected,
  onExport,
  onCreateSkill,
  onCreateInstruction,
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
  const { width, handleRef, isResizing } = useResizableSidebar();
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [expandAllSignal, setExpandAllSignal] = useState(0);
  const [inlineCreateFolderSignal, setInlineCreateFolderSignal] = useState(0);

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setCategoryFilter('');
    setTab('all');
  }, [setSearch, setCategoryFilter, setTab]);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((n) => n + 1);
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandAllSignal((n) => n + 1);
  }, []);

  const handleCreateFolder = useCallback(() => {
    setInlineCreateFolderSignal((n) => n + 1);
  }, []);

  const visibleCount = allCount;

  return (
    <aside
      style={{ width }}
      className={cn(
        'bg-background border-border relative flex shrink-0 flex-col border-r',
        isResizing && 'select-none',
      )}
    >
      <SkillsToolbar
        search={search}
        setSearch={setSearch}
        tab={tab}
        setTab={setTab}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        availableCategories={availableCategories}
        hasActiveFilters={hasActiveFilters}
        onExport={onExport}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
      />

      <SkillsActionBar
        onCreateSkill={onCreateSkill}
        onCreateInstruction={onCreateInstruction}
        onCreateFolder={handleCreateFolder}
      />

      <div className="border-border min-h-0 flex-1 overflow-hidden border-t">
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
            onCreateSkill={onCreateSkill}
            onCreateInstruction={onCreateInstruction}
            emptyLabel="No skills or instructions yet."
            collapseAllSignal={collapseAllSignal}
            expandAllSignal={expandAllSignal}
            inlineCreateFolderSignal={inlineCreateFolderSignal}
          />
        </SkillsDndProvider>
      </div>

      <SkillsFooter
        visibleCount={visibleCount}
        folderCount={folders.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
      />

      <div
        ref={handleRef}
        className={cn(
          'absolute top-0 right-0 h-full w-1 cursor-col-resize',
          'hover:bg-primary/30 transition-colors',
          isResizing && 'bg-primary/40',
        )}
        aria-hidden="true"
      />
    </aside>
  );
});
