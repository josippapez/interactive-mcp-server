import { useState, useEffect } from 'react';
import { formatRelativeTime } from '../lib/relative-time';

/**
 * Hook that returns a relative time string for a given date and updates it
 * periodically (every minute by default).
 *
 * Internally depends on the numeric timestamp (ms since epoch) so callers
 * passing a freshly constructed `new Date(...)` on every render do not
 * cause the effect to re-run on every render (which would tear down and
 * rebuild the setInterval, and in some layouts can create a render loop).
 *
 * @param date - The date to format relative to now
 * @param intervalMs - Update interval in milliseconds (default: 60000 = 1 minute)
 * @returns A relative time string like "just now", "2m ago", "1h ago", etc.
 */
export function useRelativeTime(date: Date, intervalMs = 60_000): string {
  const timeValue = date.getTime();
  const [relativeTime, setRelativeTime] = useState(() =>
    formatRelativeTime(new Date(timeValue)),
  );

  useEffect(() => {
    // Update immediately when the timestamp changes
    setRelativeTime(formatRelativeTime(new Date(timeValue)));

    // Set up periodic updates
    const intervalId = setInterval(() => {
      setRelativeTime(formatRelativeTime(new Date(timeValue)));
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [timeValue, intervalMs]);

  return relativeTime;
}
