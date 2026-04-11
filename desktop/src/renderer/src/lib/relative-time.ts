/**
 * Format a timestamp as a relative time string.
 *
 * Examples: "just now", "2m ago", "1h ago", "yesterday", "3d ago", "Mar 28"
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  // Handle future timestamps gracefully
  if (diffMs < 0) {
    return 'just now';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Less than a minute
  if (diffMinutes < 1) {
    return 'just now';
  }

  // Less than an hour
  if (diffHours < 1) {
    return `${diffMinutes}m ago`;
  }

  // Less than a day (roughly 24 hours)
  if (diffDays < 1) {
    return `${diffHours}h ago`;
  }

  // Yesterday (1-2 days ago)
  if (diffDays < 2) {
    return 'yesterday';
  }

  // Within a week
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // Older than a week - show formatted date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a timestamp as a full date/time string for hover tooltips.
 *
 * Example: "Apr 11, 2026 10:30:45 AM"
 */
export function formatFullTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}
