import React from 'react';

type Props = {
  open: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDeleteModal({
  open,
  label,
  onConfirm,
  onCancel,
}: Props): React.ReactElement | null {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-sm p-5 max-w-xs w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-sm font-medium text-[var(--color-text)] mb-1.5">
            Remove session?
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            <span className="font-mono text-[var(--color-text)]">{label}</span>{' '}
            will be permanently deleted and cannot be recovered.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-sm bg-[var(--color-error)]/20 border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/30 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
