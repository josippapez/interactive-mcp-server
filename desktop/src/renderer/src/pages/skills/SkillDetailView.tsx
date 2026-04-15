import type { SkillOrInstruction } from './skills-types';

type SkillDetailViewProps = {
  selected: SkillOrInstruction;
  singleExportStatus: string | null;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  onExportSingle: (name: string) => void;
  onDuplicate: (name: string) => void;
  onEdit: () => void;
  onDelete: (name: string) => void;
};

export function SkillDetailView({
  selected,
  singleExportStatus,
  onToggleEnabled,
  onExportSingle,
  onDuplicate,
  onEdit,
  onDelete,
}: SkillDetailViewProps): React.ReactElement {
  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-[var(--color-text)]">
          {selected.name}
        </h3>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2 items-center">
            {/* Toggle switch */}
            <button
              type="button"
              onClick={() => onToggleEnabled(selected.name, selected.enabled)}
              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                selected.enabled
                  ? 'bg-[var(--color-agent)]'
                  : 'bg-[var(--color-border)]'
              }`}
              aria-label={
                selected.enabled ? 'Disable this entry' : 'Enable this entry'
              }
              title={
                selected.enabled
                  ? 'Enabled — click to disable'
                  : 'Disabled — click to enable'
              }
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  selected.enabled ? 'left-4' : 'left-0.5'
                }`}
              />
            </button>
            <span className="text-[10px] text-[var(--color-text-faint)] w-14">
              {selected.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              type="button"
              onClick={() => onExportSingle(selected.name)}
              className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => onDuplicate(selected.name)}
              className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(selected.name)}
              className="px-2 py-1 text-xs rounded-sm border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors cursor-pointer"
            >
              Delete
            </button>
          </div>
          {singleExportStatus && (
            <span className="text-[10px] text-[var(--color-text-faint)]">
              {singleExportStatus}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-sm border ${
              selected.type === 'skill'
                ? 'border-[var(--color-agent)]/30 text-[var(--color-agent)] bg-[var(--color-agent)]/10'
                : 'border-[var(--color-user)]/30 text-[var(--color-user)] bg-[var(--color-user)]/10'
            }`}
          >
            {selected.type}
          </span>
          {selected.category && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--color-tool)]/30 text-[var(--color-tool)] bg-[var(--color-tool)]/10">
              {selected.category}
            </span>
          )}
          {selected.tags &&
            selected.tags.length > 0 &&
            selected.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-surface)]"
              >
                {tag}
              </span>
            ))}
          <span className="text-xs text-[var(--color-text-faint)]">
            Updated {selected.updatedAt}
          </span>
        </div>

        <p className="text-sm text-[var(--color-text-muted)]">
          {selected.description}
        </p>

        <div className="border-t border-[var(--color-border)] pt-3">
          <pre className="text-xs leading-relaxed text-[var(--color-text)] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-sm p-3 overflow-x-auto whitespace-pre-wrap">
            {selected.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
