import { memo, useCallback } from 'react';
import { Sparkles, FileText, MoreHorizontal } from 'lucide-react';
import type { Folder, SkillOrInstruction } from './skills-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { UseSkillsTreeKeyboardNavReturn } from './useSkillsTreeKeyboardNav';

type SkillsEntryRowProps = {
  entry: SkillOrInstruction;
  isSelected: boolean;
  indent: number;
  folders: Folder[];
  nav: UseSkillsTreeKeyboardNavReturn;
  parentFolderId: string | null;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  onMoveEntry: (name: string, folderId: number | null) => void;
};

export const SkillsEntryRow = memo(function SkillsEntryRow({
  entry,
  isSelected,
  indent,
  folders,
  nav,
  parentFolderId,
  onSelect,
  onDelete,
  onToggleEnabled,
  onMoveEntry,
}: SkillsEntryRowProps): React.ReactElement {
  const rowId = `entry:${entry.name}`;

  const handleSelect = useCallback(() => {
    onSelect(entry);
  }, [onSelect, entry]);

  const handleDelete = useCallback(() => {
    onDelete(entry.name);
  }, [onDelete, entry.name]);

  const handleToggle = useCallback(() => {
    onToggleEnabled(entry.name, entry.enabled);
  }, [onToggleEnabled, entry.name, entry.enabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      nav.onKeyDown(e, {
        rowId,
        isFolder: false,
        parentFolderId,
        onSelect: handleSelect,
        onDelete: handleDelete,
      });
    },
    [nav, rowId, parentFolderId, handleSelect, handleDelete],
  );

  const handleFocus = useCallback(() => {
    nav.setFocusedRowId(rowId);
  }, [nav, rowId]);

  const Icon = entry.type === 'skill' ? Sparkles : FileText;
  const iconClass =
    entry.type === 'skill' ? 'text-purple-500' : 'text-blue-500';

  return (
    <div
      ref={(el) => nav.registerRowRef(rowId, el)}
      role="treeitem"
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      data-row-id={rowId}
      style={{ paddingLeft: indent }}
      className={cn(
        'group relative flex h-[26px] cursor-pointer select-none items-center gap-1 pr-1 text-sm',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'hover:bg-accent/50',
        isSelected && 'bg-accent text-accent-foreground',
        !entry.enabled && 'opacity-50 italic',
      )}
    >
      <Icon
        className={cn('h-[14px] w-[14px] shrink-0', iconClass)}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>

      <div
        className={cn(
          'flex items-center gap-0.5 opacity-0 transition-opacity',
          'group-hover:opacity-100 focus-within:opacity-100',
          isSelected && 'opacity-100',
        )}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            entry.enabled ? 'bg-green-500' : 'border-muted-foreground border',
          )}
          aria-label={entry.enabled ? 'Enabled' : 'Disabled'}
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-4 w-4 items-center justify-center rounded',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                )}
                aria-label={`Actions for ${entry.name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={handleToggle}>
              {entry.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            {folders.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => onMoveEntry(entry.name, null)}
                  >
                    Unfiled
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {folders.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onClick={() => onMoveEntry(entry.name, f.id)}
                    >
                      {f.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
