import { memo, useEffect, useState } from 'react';
import {
  useConversationSelector,
  dismissSessionError,
} from '../../store/conversation-store';
import type { ConversationRetryState } from '../../store/conversation-reducer';

/**
 * Seconds remaining until `targetMs` (epoch ms), ticking once per second.
 * Returns null when there is no target.
 */
function useCountdownSeconds(targetMs: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (targetMs === null) {
      setRemaining(null);
      return;
    }
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  return remaining;
}

type SessionIssueBannerProps = {
  /** OpenCode provider session id (`ses_…`) of the displayed chat. */
  sessionId: string | null;
};

const RATE_LIMIT_PATTERN =
  /rate.?limit|usage.?limit|limit (has been |was )?reached|overloaded|quota|too many requests/i;

export function isRateLimitRetry(retry: ConversationRetryState): boolean {
  if (retry.statusCode === 429) return true;
  return RATE_LIMIT_PATTERN.test(retry.message);
}

function retryHeadline(retry: ConversationRetryState): string {
  const subject = isRateLimitRetry(retry)
    ? 'Rate limit reached'
    : 'Provider issue';
  return `${subject} — retrying (attempt ${retry.attempt})`;
}

/**
 * Inline chat banner surfacing per-session provider issues:
 *
 *   - Active retry (`session.next.retried`): rate limit / transient
 *     provider failure, shown while OpenCode retries the request.
 *   - Session error (`session.status` error): the provider error
 *     message, dismissible, cleared automatically when the session
 *     resumes streaming.
 */
function SessionIssueBanner({
  sessionId,
}: SessionIssueBannerProps): React.ReactElement | null {
  const retry = useConversationSelector((state) =>
    sessionId ? (state.retries[sessionId] ?? null) : null,
  );
  const error = useConversationSelector((state) =>
    sessionId ? (state.errors[sessionId] ?? null) : null,
  );
  // `retry.at` is the epoch ms of the next scheduled attempt.
  const nextAttemptIn = useCountdownSeconds(retry ? retry.at : null);

  if (!sessionId) return null;

  if (retry) {
    const action = retry.action;
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 border-b border-yellow-500/20 bg-yellow-500/10 text-xs text-yellow-600 dark:text-yellow-400"
        role="status"
        data-testid="session-retry-banner"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse shrink-0" />
        <span className="font-medium shrink-0">
          {action?.title || retryHeadline(retry)}
        </span>
        {nextAttemptIn !== null && (
          <span className="shrink-0 tabular-nums" data-testid="retry-countdown">
            {nextAttemptIn > 0
              ? `· next attempt in ${nextAttemptIn}s`
              : '· retrying now…'}
          </span>
        )}
        <span className="truncate text-yellow-600/70 dark:text-yellow-400/70">
          {action?.message || retry.message}
        </span>
        {action?.link && (
          <a
            href={action.link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 underline hover:no-underline font-medium"
            data-testid="retry-action-link"
          >
            {action.label || 'Learn more'}
          </a>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-error)]/20 bg-[var(--color-error)]/10 text-xs text-[var(--color-error)]"
        role="alert"
        data-testid="session-error-banner"
      >
        <span className="truncate">Session error: {error}</span>
        <button
          type="button"
          onClick={() => dismissSessionError(sessionId)}
          className="ml-3 text-[var(--color-error)]/60 hover:text-[var(--color-error)] transition-colors cursor-pointer shrink-0"
          aria-label="Dismiss session error"
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
}

export default memo(SessionIssueBanner);
