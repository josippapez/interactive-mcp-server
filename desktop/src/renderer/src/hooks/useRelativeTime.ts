import { useState, useEffect } from 'react';
import { formatRelativeTime } from '../lib/relative-time';

/**
 * Hook that returns a relative time string for a given date and updates it
 * periodically (every minute by default).
 *
 * @param date - The date to format relative to now
 * @param intervalMs - Update interval in milliseconds (default: 60000 = 1 minute)
 * @returns A relative time string like "just now", "2m ago", "1h ago", etc.
 */
export function useRelativeTime(date: Date, intervalMs = 60_000): string {
  const [relativeTime, setRelativeTime] = useState(() =>
    formatRelativeTime(date),
  );

  useEffect(() => {
    // Update immediately when the date changes
    setRelativeTime(formatRelativeTime(date));

    // Set up periodic updates
    const intervalId = setInterval(() => {
      setRelativeTime(formatRelativeTime(date));
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [date, intervalMs]);

  return relativeTime;
}
