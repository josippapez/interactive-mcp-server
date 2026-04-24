import { useMemo } from 'react';
import { Button } from './ui/button';
import { buildAllowFolderOptions } from './allow-folder-options';

type Props = {
  filePath: string;
  onSelectFolder: (folderPath: string) => void;
  onCancel: () => void;
};

/**
 * Modal for selecting which folder to allow for auto-approval.
 * Shows immediate parent folder and detected project root.
 */
export default function AllowFolderModal({
  filePath,
  onSelectFolder,
  onCancel,
}: Props): React.ReactElement {
  const folderOptions = useMemo(
    () => buildAllowFolderOptions(filePath),
    [filePath],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/35">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/80 px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Allow Folder for Auto-Approval
          </h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Future file read requests from this folder will be auto-approved.
          </p>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
            File Requested
          </p>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)]/70 px-3 py-2 font-mono text-[11px] leading-5 text-[var(--color-text-muted)] break-all">
            {filePath}
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
            Select folder to allow:
          </p>
          <div className="space-y-2.5">
            {folderOptions.map((option) => (
              <button
                key={option.path}
                type="button"
                onClick={() => onSelectFolder(option.path)}
                className="group flex w-full items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)]/45 px-3.5 py-3 text-left transition-colors hover:border-[var(--color-agent)]/50 hover:bg-[var(--color-agent)]/6"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-faint)] transition-colors group-hover:border-[var(--color-agent)]/40 group-hover:text-[var(--color-agent)]">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      {option.label}
                    </p>
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-faint)]">
                      {option.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {option.hint}
                  </p>
                  <p className="mt-1.5 break-all font-mono text-[11px] text-[var(--color-text-faint)]">
                    {option.path}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/80 px-5 py-4">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
