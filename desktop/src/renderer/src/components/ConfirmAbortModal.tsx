import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog';

type Props = {
  open: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmAbortModal({
  open,
  label,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Abort session?</AlertDialogTitle>
          <AlertDialogDescription>
            This will stop the running agent in{' '}
            <span className="font-mono text-[var(--color-text)]">{label}</span>.
            The session will remain but the current task will be interrupted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-amber-500/20 border border-amber-500/30 text-amber-500 hover:bg-amber-500/30"
          >
            Abort
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
