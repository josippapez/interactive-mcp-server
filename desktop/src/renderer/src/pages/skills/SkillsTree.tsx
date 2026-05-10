import { memo, useState } from 'react';
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Folder, SkillOrInstruction } from './skills-types';
import { SidebarItem } from './SidebarItem';
import { DraggableEntryCard } from './dnd/DraggableEntryCard';
import { FolderDropZone } from './dnd/FolderDropZone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverPositioner,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

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
  onMoveEntry: (name: string, folderId: number | null) => void;
  emptyLabel: string;
};

/**
 * Folder tree for skills & instructions.
 *
 * Renders the special "Unfiled" section first, then user-defined folders
 * as collapsible groups. Each section is a drop target via the
 * `FolderDropZone` primitive; entry cards are wrapped in
 * `DraggableEntryCard` for drag-and-drop file management.
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
  const [unfiledCollapsed, setUnfiledCollapsed] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isEmpty ? (
          <div className="text-muted-foreground p-3 text-xs">{emptyLabel}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Unfiled section — always shown */}
            <FolderDropZone folderId={null}>
              {(() => {
                return (
                  <Collapsible
                    open={!unfiledCollapsed}
                    onOpenChange={(open) => setUnfiledCollapsed(!open)}
                  >
                    <FolderHeader
                      icon={
                        unfiledCollapsed ? (
                          <FolderIcon className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <FolderOpen className="h-4 w-4" aria-hidden="true" />
                        )
                      }
                      isCollapsed={unfiledCollapsed}
                      name="Unfiled"
                      count={unfiledEntries.length}
                    />
                    <CollapsibleContent>
                      <div className="mt-1 flex flex-col gap-1.5 pl-1">
                        {unfiledEntries.length === 0 ? (
                          <p className="text-muted-foreground/70 px-2 py-1 text-xs italic">
                            Drop entries here to unfile.
                          </p>
                        ) : (
                          unfiledEntries.map((entry) => (
                            <DraggableEntryCard
                              key={entry.id}
                              entryName={entry.name}
                              className="data-[dragging=true]:opacity-40"
                            >
                              <SidebarItem
                                entry={entry}
                                isSelected={selected?.id === entry.id}
                                onSelect={onSelect}
                                onDelete={onDelete}
                                onToggleEnabled={onToggleEnabled}
                                folders={folders}
                                onMoveEntry={onMoveEntry}
                              />
                            </DraggableEntryCard>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })()}
            </FolderDropZone>

            {/* User folders */}
            {folders.map((folder) => {
              const children = entriesByFolder[folder.id] ?? [];
              const isCollapsed = collapsed.has(folder.id);
              return (
                <FolderDropZone
                  key={folder.id}
                  folderId={folder.id}
                  className="data-[over=true]:bg-accent/30 data-[over=true]:ring-primary/40 rounded-md transition-colors data-[over=true]:ring-1"
                >
                  <Collapsible
                    open={!isCollapsed}
                    onOpenChange={() => toggleFolder(folder.id)}
                  >
                    <FolderHeader
                      icon={
                        isCollapsed ? (
                          <FolderIcon className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <FolderOpen className="h-4 w-4" aria-hidden="true" />
                        )
                      }
                      isCollapsed={isCollapsed}
                      name={folder.name}
                      count={children.length}
                      onRename={() => void handleRename(folder)}
                      onDelete={() => void handleDelete(folder)}
                    />
                    <CollapsibleContent>
                      <div className="mt-1 flex flex-col gap-1.5 pl-1">
                        {children.length === 0 ? (
                          <p className="text-muted-foreground/70 px-2 py-1 text-xs italic">
                            Empty. Drag entries here.
                          </p>
                        ) : (
                          children.map((entry) => (
                            <DraggableEntryCard
                              key={entry.id}
                              entryName={entry.name}
                              className="data-[dragging=true]:opacity-40"
                            >
                              <SidebarItem
                                entry={entry}
                                isSelected={selected?.id === entry.id}
                                onSelect={onSelect}
                                onDelete={onDelete}
                                onToggleEnabled={onToggleEnabled}
                                folders={folders}
                                onMoveEntry={onMoveEntry}
                              />
                            </DraggableEntryCard>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </FolderDropZone>
              );
            })}
          </div>
        )}
      </div>

      {/* Add folder action */}
      <div className="border-border border-t p-2">
        <Popover
          open={creatingFolder}
          onOpenChange={(open) => {
            setCreatingFolder(open);
            if (!open) setNewFolderName('');
          }}
        >
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground w-full justify-start"
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                Add folder
              </Button>
            }
          />
          <PopoverPositioner side="top" align="start" sideOffset={6}>
            <PopoverContent className="w-64 p-3">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="new-folder-name"
                  className="text-foreground text-xs font-medium"
                >
                  New folder
                </label>
                <Input
                  id="new-folder-name"
                  autoFocus
                  value={newFolderName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewFolderName(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreate();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setNewFolderName('');
                      setCreatingFolder(false);
                    }
                  }}
                  placeholder="Folder name"
                  className="h-8 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNewFolderName('');
                      setCreatingFolder(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCreate()}
                    disabled={!newFolderName.trim()}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </PopoverPositioner>
        </Popover>
      </div>
    </div>
  );
});

type FolderHeaderProps = {
  icon: React.ReactNode;
  isCollapsed: boolean;
  name: string;
  count: number;
  onRename?: () => void;
  onDelete?: () => void;
};

function FolderHeader({
  icon,
  isCollapsed,
  name,
  count,
  onRename,
  onDelete,
}: FolderHeaderProps): React.ReactElement {
  const hasMenu = Boolean(onRename || onDelete);

  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs',
              'text-foreground hover:bg-accent/60 transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            )}
            aria-expanded={!isCollapsed}
          >
            <ChevronRight
              className={cn(
                'text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform',
                !isCollapsed && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <span className="text-muted-foreground shrink-0">{icon}</span>
            <span className="flex-1 truncate font-medium">{name}</span>
            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
              {count}
            </span>
          </button>
        }
      />

      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${name}`}
                className={cn(
                  'text-muted-foreground hover:bg-accent hover:text-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100',
                )}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[140px]">
            {onRename && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Rename
              </DropdownMenuItem>
            )}
            {onRename && onDelete && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
