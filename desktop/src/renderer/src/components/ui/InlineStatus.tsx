import * as React from 'react';
import { cn } from '@/lib/utils';

export type InlineStatusState = 'idle' | 'saving' | 'saved' | 'error';

export interface InlineStatusProps {
  state: InlineStatusState;
  message?: string;
  className?: string;
}

/**
 * Small status banner used in forms and lists to surface async save state.
 *
 * - Renders nothing when `state === 'idle'` and no `message` is provided.
 * - Uses `role="alert"` for the `error` state (assertive) and `role="status"`
 *   for saving / saved (polite).
 * - Colours follow the project's existing `--color-*` CSS custom properties
 *   (see SettingsSectionBasics / badge.tsx for precedent).
 */
export function InlineStatus({
  state,
  message,
  className,
}: InlineStatusProps): React.ReactElement | null {
  if (state === 'idle') {
    return null;
  }

  const isError = state === 'error';
  const role = isError ? 'alert' : 'status';
  const ariaLive: 'assertive' | 'polite' = isError ? 'assertive' : 'polite';

  const toneClass =
    state === 'error'
      ? 'text-[var(--color-error)]'
      : state === 'saved'
        ? 'text-[var(--color-success,#22c55e)]'
        : 'text-[var(--color-text-muted)]';

  const defaultMessage =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Something went wrong'
          : '';

  const text = message ?? defaultMessage;

  return (
    <span
      role={role}
      aria-live={ariaLive}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs leading-none',
        toneClass,
        className,
      )}
    >
      {state === 'saving' && (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70 animate-pulse"
        />
      )}
      {text}
    </span>
  );
}

export default InlineStatus;
