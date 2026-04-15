import { memo } from 'react';
import type { SkillOrInstruction } from './skills-types';

type SidebarItemProps = {
  entry: SkillOrInstruction;
  isSelected: boolean;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
};

/**
 * Memoized sidebar item component to prevent unnecessary re-renders when
 * other items in the list update but this specific item hasn't changed.
 */
export const SidebarItem = memo(function SidebarItem({
  entry,
  isSelected,
  onSelect,
  onDelete,
  onToggleEnabled,
}: SidebarItemProps): React.ReactElement {
  const handleSelect = (): void => {
    onSelect(entry);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        event.preventDefault();
        handleSelect();
      }}
      className={`w-full text-left px-3 py-2 text-xs transition-colors group ${
        isSelected
          ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
      } ${!entry.enabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-medium flex items-center gap-1">
          {entry.name}
          {entry.isBuiltin && (
            <span
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-tool)]/20 text-[var(--color-tool)]"
              title="Built-in template"
            >
              Built-in
            </span>
          )}
          {!entry.enabled && (
            <span
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-text-faint)]/20 text-[var(--color-text-faint)]"
              title="Disabled - will not be injected into agent sessions"
            >
              Off
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {/* Toggle switch */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnabled(entry.name, entry.enabled);
            }}
            className={`relative w-6 h-3.5 rounded-full transition-colors cursor-pointer ${
              entry.enabled
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
            aria-label={`${entry.enabled ? 'Disable' : 'Enable'} ${entry.name}`}
            title={entry.enabled ? 'Disable' : 'Enable'}
          >
            <span
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                entry.enabled ? 'left-3' : 'left-0.5'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.name);
            }}
            className="opacity-0 group-hover:opacity-100 text-[var(--color-text-faint)] hover:text-[var(--color-error)] transition-all cursor-pointer text-[10px]"
            aria-label={`Delete ${entry.name}`}
          >
            x
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
        {entry.category && (
          <span className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-tool)]/10 text-[var(--color-tool)]">
            {entry.category}
          </span>
        )}
        {entry.tags &&
          entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-surface)] text-[var(--color-text-faint)]"
            >
              {tag}
            </span>
          ))}
        {entry.tags && entry.tags.length > 2 && (
          <span className="text-[8px] text-[var(--color-text-faint)]">
            +{entry.tags.length - 2}
          </span>
        )}
      </div>
      <p className="truncate text-[var(--color-text-faint)] mt-0.5">
        {entry.description}
      </p>
    </div>
  );
});
