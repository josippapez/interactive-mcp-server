import { memo } from 'react';

type ActiveSessionBannerProps = {
  /** Title of the active session */
  sessionTitle: string;
  /** Connection ID for terminating the session */
  connectionId: string | null;
};

/**
 * Displays a banner for an active intensive chat session with a terminate button.
 */
function ActiveSessionBanner({
  sessionTitle,
  connectionId,
}: ActiveSessionBannerProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs text-[var(--color-text-muted)]">
          session:{' '}
          <span className="text-[var(--color-text-muted)]">{sessionTitle}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          connectionId && window.api.forceTerminateChat(connectionId)
        }
        className="px-2 py-0.5 text-[10px] rounded-sm bg-[#331111] text-[var(--color-error)] hover:bg-[#441111] hover:text-[#ff4444] transition-colors cursor-pointer border border-[#442222]"
        title="Force terminate this conversation"
      >
        ✕ Terminate
      </button>
    </div>
  );
}

export default memo(ActiveSessionBanner);
