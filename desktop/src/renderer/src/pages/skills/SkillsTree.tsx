import { memo, useState } from 'react';
import type { Folder, SkillOrInstruction } from './skills-types';
import { SidebarItem } from './SidebarItem';

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
  onDeleteFolder: (id: number) => Promise<void>;
  /**
   * Move an entry to the given folder (null = unfile / root). Called on
   * drag-and-drop onto a folder header or the root drop zone.
   */
  onMoveEntry: (name: string, folderId: number | null) => void;
  emptyLabel: string;
};

const DND_MIME = 'application/x-skills-entry-name';

/**
 * VSCode-style tree view for skills & instructions.
 *
 * Unfiled entries (folderId === null) are rendered at the root, like
 * files sitting in a workspace root. Folders render as collapsible
 * nodes with their contained entries nested (indented) beneath.
 *
 * Collapse state is stored as a `Set<number>` of collapsed folder ids —
 * absence from the set means expanded (default).
 */
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
  emptyLabel,
}: SkillsTreeProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dropTarget, setDropTarget] = useState<number | 'root' | null>(null);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    name: string,
  ): void => {
    e.dataTransfer.setData(DND_MIME, name);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    target: number | 'root',
  ): void => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    folderId: number | null,
  ): void => {
    const name = e.dataTransfer.getData(DND_MIME);
    setDropTarget(null);
    if (!name) return;
    e.preventDefault();
    onMoveEntry(name, folderId);
  };

  const toggleFolder = (id: number): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async (): Promise<void> => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    await onCreateFolder(trimmed);
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const handleRename = async (folder: Folder): Promise<void> => {
    const next = window.prompt('Rename folder', folder.name);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === folder.name) return;
    await onRenameFolder(folder.id, trimmed);
  };

  const handleDelete = async (folder: Folder): Promise<void> => {
    const ok = window.confirm(
      `Delete folder "${folder.name}"? Entries in this folder will be unfiled.`,
    );
    if (!ok) return;
    await onDeleteFolder(folder.id);
  };

  const totalVisible =
    unfiledEntries.length +
    folders.reduce((sum, f) => sum + (entriesByFolder[f.id]?.length ?? 0), 0);

  const isEmpty = totalVisible === 0 && folders.length === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Toolbar: "+ New folder" */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
          Explorer
        </span>
        <button
          type="button"
          onClick={() => setCreatingFolder((c) => !c)}
          title="Create folder"
          className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
        >
          + New folder
        </button>
      </div>

      {creatingFolder && (
        <div className="flex items-center gap-1 px-3 py-1">
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewFolderName(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') {
                setNewFolderName('');
                setCreatingFolder(false);
              }
            }}
            placeholder="Folder name"
            className="flex-1 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-0.5 text-xs text-[var(--color-text)]"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="text-[10px] px-1.5 py-0.5 rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
          >
            Add
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="p-3 text-xs text-[var(--color-text-faint)]">
          {emptyLabel}
        </div>
      ) : (
        <>
          {/* Root drop zone (unfile) */}
          <div
            onDragOver={(e) => handleDragOver(e, 'root')}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => handleDrop(e, null)}
            className={
              dropTarget === 'root'
                ? 'bg-[var(--color-accent)]/10 border-y border-dashed border-[var(--color-accent)]/60'
                : ''
            }
          >
            {/* Unfiled entries — shown at root, no wrapper */}
            {unfiledEntries.map((entry) => (
              <div
                key={entry.id}
                draggable
                onDragStart={(e) => handleDragStart(e, entry.name)}
              >
                <SidebarItem
                  entry={entry}
                  isSelected={selected?.id === entry.id}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onToggleEnabled={onToggleEnabled}
                />
              </div>
            ))}
            {unfiledEntries.length === 0 && dropTarget === 'root' && (
              <div className="px-3 py-2 text-[10px] text-[var(--color-accent)]">
                Drop here to unfile
              </div>
            )}
          </div>

          {/* Folders */}
          {folders.map((folder) => {
            const children = entriesByFolder[folder.id] ?? [];
            const isCollapsed = collapsed.has(folder.id);
            const isDropTarget = dropTarget === folder.id;
            return (
              <div key={folder.id}>
                <div
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                  className={
                    isDropTarget
                      ? 'bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/60'
                      : ''
                  }
                >
                  <FolderHeader
                    folder={folder}
                    count={children.length}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleFolder(folder.id)}
                    onRename={() => void handleRename(folder)}
                    onDelete={() => void handleDelete(folder)}
                  />
                </div>
                {!isCollapsed &&
                  children.map((entry) => (
                    <div
                      key={entry.id}
                      className="pl-4"
                      draggable
                      onDragStart={(e) => handleDragStart(e, entry.name)}
                    >
                      <SidebarItem
                        entry={entry}
                        isSelected={selected?.id === entry.id}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        onToggleEnabled={onToggleEnabled}
                      />
                    </div>
                  ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
});

type FolderHeaderProps = {
  folder: Folder;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function FolderHeader({
  folder,
  count,
  isCollapsed,
  onToggle,
  onRename,
  onDelete,
}: FolderHeaderProps): React.ReactElement {
  return (
    <div
      className="group flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50 hover:text-[var(--color-text)] cursor-pointer transition-colors"
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={!isCollapsed}
    >
      <span
        aria-hidden="true"
        className="w-3 text-[var(--color-text-faint)] shrink-0"
      >
        {isCollapsed ? '▸' : '▾'}
      </span>
      <span
        aria-hidden="true"
        className="text-[var(--color-text-faint)] shrink-0"
      >
        {isCollapsed ? '📁' : '📂'}
      </span>
      <span className="flex-1 truncate font-medium">{folder.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-all cursor-pointer"
        title="Rename"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-error)] transition-all cursor-pointer"
        title="Delete"
      >
        x
      </button>
      <span className="text-[9px] text-[var(--color-text-faint)] w-5 text-right shrink-0">
        {count}
      </span>
    </div>
  );
}
