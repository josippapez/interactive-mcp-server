import { memo, useCallback, useEffect, useState } from 'react';
import type { Folder, SkillOrInstruction } from './skills-types';
import { SkillsTreeRow } from './SkillsTreeRow';
import { SkillsEntryRow } from './SkillsEntryRow';
import { DraggableEntryCard } from './dnd/DraggableEntryCard';
import { FolderDropZone } from './dnd/FolderDropZone';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSkillsTreeKeyboardNav } from './useSkillsTreeKeyboardNav';

const UNFILED_ROW_ID = 'folder:unfiled';

type SkillsTreeProps = {
  folders: Folder[];
  unfiledEntries: SkillOrInstruction[];
  entriesByFolder: Record<number, SkillOrInstruction[]>;
  selected: SkillOrInstruction | null;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number) => void;
  onMoveEntry: (name: string, folderId: number | null) => void;
  onCreateSkill: () => void;
  onCreateInstruction: () => void;
  emptyLabel: string;
  collapseAllSignal: number;
  expandAllSignal: number;
  inlineCreateFolderSignal: number;
};

export const SkillsTree = memo(function SkillsTree({
  folders,
  unfiledEntries,
  entriesByFolder,
  selected,
  onSelect,
  onDelete,
  onToggleEnabled,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveEntry,
  onCreateSkill,
  onCreateInstruction,
  emptyLabel,
  collapseAllSignal,
  expandAllSignal,
  inlineCreateFolderSignal,
}: SkillsTreeProps): React.ReactElement {
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const [unfiledOpen, setUnfiledOpen] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const nav = useSkillsTreeKeyboardNav();

  const toggleFolder = useCallback((id: number) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (collapseAllSignal === 0) return;
    setUnfiledOpen(false);
    setOpenFolders(new Set());
  }, [collapseAllSignal]);

  useEffect(() => {
    if (expandAllSignal === 0) return;
    setUnfiledOpen(true);
    setOpenFolders(new Set(folders.map((f) => f.id)));
  }, [expandAllSignal, folders]);

  useEffect(() => {
    if (inlineCreateFolderSignal === 0) return;
    setCreatingFolder(true);
    setNewFolderName('');
  }, [inlineCreateFolderSignal]);

  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      return;
    }
    await onCreateFolder(trimmed);
    setNewFolderName('');
    setCreatingFolder(false);
  }, [newFolderName, onCreateFolder]);

  const handleNewFolderKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleCreateFolder();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setCreatingFolder(false);
        setNewFolderName('');
      }
    },
    [handleCreateFolder],
  );

  const visibleRowIds: string[] = [];
  visibleRowIds.push(UNFILED_ROW_ID);
  if (unfiledOpen) {
    for (const e of unfiledEntries) {
      visibleRowIds.push(`entry:${e.name}`);
    }
  }
  for (const folder of folders) {
    visibleRowIds.push(`folder:${folder.id}`);
    if (openFolders.has(folder.id)) {
      const children = entriesByFolder[folder.id] ?? [];
      for (const e of children) {
        visibleRowIds.push(`entry:${e.name}`);
      }
    }
  }
  nav.setVisibleRowIds(visibleRowIds);

  const totalVisible =
    unfiledEntries.length +
    folders.reduce((sum, f) => sum + (entriesByFolder[f.id]?.length ?? 0), 0);
  const isEmpty = totalVisible === 0 && folders.length === 0;

  return (
    <div
      role="tree"
      aria-label="Skills and instructions"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {isEmpty ? (
        <div className="text-muted-foreground px-3 py-2 text-xs">
          {emptyLabel}
        </div>
      ) : (
        <>
          <FolderDropZone
            folderId={null}
            className="data-[over=true]:bg-accent/30"
          >
            <div
              ref={(el) => nav.registerRowRef(UNFILED_ROW_ID, el)}
              role="treeitem"
              aria-expanded={unfiledOpen}
              tabIndex={0}
              onKeyDown={(e) =>
                nav.onKeyDown(e, {
                  rowId: UNFILED_ROW_ID,
                  isFolder: true,
                  isOpen: unfiledOpen,
                  onToggle: () => setUnfiledOpen((v) => !v),
                })
              }
              onFocus={() => nav.setFocusedRowId(UNFILED_ROW_ID)}
              className={cn(
                'group flex h-[26px] cursor-pointer select-none items-center gap-1 px-1',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                'hover:bg-accent/50',
              )}
              onClick={() => setUnfiledOpen((v) => !v)}
            >
              <button
                type="button"
                tabIndex={-1}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                aria-label={unfiledOpen ? 'Collapse Unfiled' : 'Expand Unfiled'}
                onClick={(e) => {
                  e.stopPropagation();
                  setUnfiledOpen((v) => !v);
                }}
              >
                <svg
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    unfiledOpen && 'rotate-90',
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium italic">
                Unfiled
              </span>
              <span className="text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums">
                {unfiledEntries.length}
              </span>
            </div>

            {unfiledOpen && (
              <div role="group">
                {unfiledEntries.length === 0 ? (
                  <div className="text-muted-foreground/60 flex h-[26px] items-center pl-8 text-xs italic">
                    Drop entries here
                  </div>
                ) : (
                  unfiledEntries.map((entry) => (
                    <DraggableEntryCard
                      key={entry.id}
                      entryName={entry.name}
                      className="data-[dragging=true]:opacity-40"
                    >
                      <SkillsEntryRow
                        entry={entry}
                        isSelected={selected?.id === entry.id}
                        indent={14}
                        folders={folders}
                        nav={nav}
                        parentFolderId={UNFILED_ROW_ID}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        onToggleEnabled={onToggleEnabled}
                        onMoveEntry={onMoveEntry}
                      />
                    </DraggableEntryCard>
                  ))
                )}
              </div>
            )}
          </FolderDropZone>

          {folders.map((folder) => {
            const children = entriesByFolder[folder.id] ?? [];
            const isOpen = openFolders.has(folder.id);
            const folderRowId = `folder:${folder.id}`;

            return (
              <FolderDropZone
                key={folder.id}
                folderId={folder.id}
                className="data-[over=true]:bg-accent/30"
              >
                <SkillsTreeRow
                  folder={folder}
                  isOpen={isOpen}
                  count={children.length}
                  nav={nav}
                  onToggle={() => toggleFolder(folder.id)}
                  onRename={onRenameFolder}
                  onDelete={onDeleteFolder}
                  onCreateSkillInFolder={onCreateSkill}
                  onCreateInstructionInFolder={onCreateInstruction}
                />

                {isOpen && (
                  <div role="group">
                    {children.length === 0 ? (
                      <div className="text-muted-foreground/60 flex h-[26px] items-center pl-8 text-xs italic">
                        Drop entries here
                      </div>
                    ) : (
                      children.map((entry) => (
                        <DraggableEntryCard
                          key={entry.id}
                          entryName={entry.name}
                          className="data-[dragging=true]:opacity-40"
                        >
                          <SkillsEntryRow
                            entry={entry}
                            isSelected={selected?.id === entry.id}
                            indent={14}
                            folders={folders}
                            nav={nav}
                            parentFolderId={folderRowId}
                            onSelect={onSelect}
                            onDelete={onDelete}
                            onToggleEnabled={onToggleEnabled}
                            onMoveEntry={onMoveEntry}
                          />
                        </DraggableEntryCard>
                      ))
                    )}
                  </div>
                )}
              </FolderDropZone>
            );
          })}
        </>
      )}

      {creatingFolder && (
        <div className="flex h-[26px] items-center gap-1 px-2">
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewFolderName(e.target.value)
            }
            onKeyDown={handleNewFolderKeyDown}
            onBlur={() => void handleCreateFolder()}
            placeholder="Folder name…"
            className="h-5 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-1"
            aria-label="New folder name"
          />
        </div>
      )}
    </div>
  );
});
