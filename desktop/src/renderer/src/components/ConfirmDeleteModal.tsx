import React from 'react';
import { ConfirmDialog } from './ui/ConfirmDialog';

type Props = {
  open: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Session-specific delete confirmation. Thin wrapper over the generic
 * `ConfirmDialog` that bakes in the "Remove session?" title, destructive
 * styling, and the monospace label span inside the description.
 *
 * Prefer `ConfirmDialog` (components/ui/ConfirmDialog.tsx) directly for
 * new confirm flows that don't reuse this exact copy.
 */
export default function ConfirmDeleteModal({
  open,
  label,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  return (
    <ConfirmDialog
      open={open}
      title="Remove session?"
      description={
        <>
          <span className="font-mono text-[var(--color-text)]">{label}</span>{' '}
          will be permanently deleted and cannot be recovered.
        </>
      }
      confirmLabel="Delete"
      cancelLabel="Cancel"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
