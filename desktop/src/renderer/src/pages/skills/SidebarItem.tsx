import { memo } from 'react';
import { MoreHorizontal, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { SkillOrInstruction, Folder } from './skills-types';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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

type SidebarItemProps = {
  entry: SkillOrInstruction;
  isSelected: boolean;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  /** All folders, used for the "Move to folder" submenu. */
  folders: Folder[];
  /** Move entry to a folder (null = unfiled). */
  onMoveEntry: (name: string, folderId: number | null) => void;
};

/**
 * Card-style row for a single skill or instruction. Clickable, keyboard
 * accessible, and includes a context menu (toggle enabled, move, delete).
 *
 * Memoized to avoid re-renders when sibling entries change.
 */
export const SidebarItem = memo(function SidebarItem({
  entry,
  isSelected,
  onSelect,
  onDelete,
  onToggleEnabled,
  folders,
  onMoveEntry,
}: SidebarItemProps): React.ReactElement {
  const handleSelect = (): void => {
    onSelect(entry);
  };

  const typeBadgeVariant = entry.type === 'skill' ? 'default' : 'secondary';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleSelect();
      }}
      data-selected={isSelected ? 'true' : undefined}
      className={cn(
        'group bg-card text-card-foreground border-border relative flex flex-col gap-1.5 rounded-md border p-3 text-left transition-colors',
        'hover:bg-accent/50 cursor-pointer',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        isSelected && 'bg-accent ring-primary border-primary/40 ring-1',
        !entry.enabled && 'opacity-60',
      )}
    >
      {/* Top row: type badge, name, toggle, menu */}
      <div className="flex items-center gap-2">
        <Badge
          variant={typeBadgeVariant}
          className="shrink-0 px-1.5 py-0 text-[10px] uppercase tracking-wide"
        >
          {entry.type}
        </Badge>
        <span className="text-foreground flex-1 truncate text-sm font-medium">
          {entry.name}
        </span>
        {/* Toggle switch */}
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={entry.enabled}
            onCheckedChange={() => onToggleEnabled(entry.name, entry.enabled)}
            aria-label={`${entry.enabled ? 'Disable' : 'Enable'} ${entry.name}`}
          />
        </div>

        {/* Context menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${entry.name}`}
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
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onToggleEnabled(entry.name, entry.enabled);
              }}
            >
              {entry.enabled ? (
                <ToggleLeft className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ToggleRight className="h-4 w-4" aria-hidden="true" />
              )}
              {entry.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[160px]">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveEntry(entry.name, null);
                  }}
                  disabled={entry.folderId === null}
                >
                  Unfiled
                </DropdownMenuItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveEntry(entry.name, f.id);
                    }}
                    disabled={entry.folderId === f.id}
                  >
                    {f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(entry.name);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      {entry.description && (
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {entry.description}
        </p>
      )}

      {/* Bottom row: chips */}
      <div className="flex flex-wrap items-center gap-1">
        {entry.category && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {entry.category}
          </Badge>
        )}
        {entry.tags &&
          entry.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {tag}
            </Badge>
          ))}
        {entry.tags && entry.tags.length > 3 && (
          <span className="text-muted-foreground text-[10px]">
            +{entry.tags.length - 3}
          </span>
        )}
        {entry.isBuiltin && (
          <Badge
            variant="outline"
            className="text-primary border-primary/40 px-1.5 py-0 text-[10px]"
            title="Built-in template"
          >
            Built-in
          </Badge>
        )}
        {entry.scope === 'session-scoped' && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px]"
            title="Session-scoped — only injected into channels that opt in"
          >
            Scoped
          </Badge>
        )}
      </div>
    </div>
  );
});
