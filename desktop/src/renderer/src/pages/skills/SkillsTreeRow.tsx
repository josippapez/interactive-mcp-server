import { memo, useCallback, useRef, useState } from 'react';
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
} from 'lucide-react';
import type { Folder } from './skills-types';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { UseSkillsTreeKeyboardNavReturn } from './useSkillsTreeKeyboardNav';

type SkillsTreeRowProps = {
  folder: Folder;
  isOpen: boolean;
  count: number;
  nav: UseSkillsTreeKeyboardNavReturn;
  onToggle: () => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => void;
  onCreateSkillInFolder: () => void;
  onCreateInstructionInFolder: () => void;
};

export const SkillsTreeRow = memo(function SkillsTreeRow({
  folder,
  isOpen,
  count,
  nav,
  onToggle,
  onRename,
  onDelete,
  onCreateSkillInFolder,
  onCreateInstructionInFolder,
}: SkillsTreeRowProps): React.ReactElement {
  const rowId = `folder:${folder.id}`;
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const startRename = useCallback(() => {
    setRenameValue(folder.name);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [folder.name]);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) {
      void onRename(folder.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, folder.name, folder.id, onRename]);

  const cancelRename = useCallback(() => {
    setRenameValue(folder.name);
    setIsRenaming(false);
  }, [folder.name]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      nav.onKeyDown(e, {
        rowId,
        isFolder: true,
        isOpen,
        onToggle,
        onRename: startRename,
      });
    },
    [nav, rowId, isOpen, onToggle, startRename],
  );

  const handleFocus = useCallback(() => {
    nav.setFocusedRowId(rowId);
  }, [nav, rowId]);

  const handleDeleteClick = useCallback(() => {
    onDelete(folder.id);
  }, [onDelete, folder.id]);

  return (
    <div
      ref={(el) => nav.registerRowRef(rowId, el)}
      role="treeitem"
      aria-expanded={isOpen}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      data-row-id={rowId}
      className={cn(
        'group flex h-[26px] cursor-pointer select-none items-center gap-1 px-1 text-sm',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        tabIndex={-1}
        aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 transition-transform',
            isOpen && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <FolderOpen className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
      ) : (
        <FolderIcon className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
      )}

      {isRenaming ? (
        <Input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={commitRename}
          className="h-5 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-1"
          aria-label="Rename folder"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          onDoubleClick={startRename}
        >
          {folder.name}
        </span>
      )}

      <span className="text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums">
        {count}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                'text-muted-foreground hover:text-foreground flex h-4 w-4 shrink-0 items-center justify-center rounded',
                'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
              aria-label={`Actions for ${folder.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onClick={startRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={onCreateSkillInFolder}>
            New skill in folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCreateInstructionInFolder}>
            New instruction in folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDeleteClick}
            className="text-destructive focus:text-destructive"
          >
            Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
