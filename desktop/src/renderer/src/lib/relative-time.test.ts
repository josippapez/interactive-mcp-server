import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime, formatFullTimestamp } from './relative-time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Fix "now" to Apr 11, 2026 at 10:30:45 AM for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T10:30:45.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps within the last minute', () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe('just now');

    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('just now');

    const fiftyNineSecondsAgo = new Date(Date.now() - 59 * 1000);
    expect(formatRelativeTime(fiftyNineSecondsAgo)).toBe('just now');
  });

  it('returns "1m ago" for timestamps exactly 1 minute ago', () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    expect(formatRelativeTime(oneMinuteAgo)).toBe('1m ago');
  });

  it('returns "Xm ago" for timestamps within the last hour', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    expect(formatRelativeTime(twoMinutesAgo)).toBe('2m ago');

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(formatRelativeTime(thirtyMinutesAgo)).toBe('30m ago');

    const fiftyNineMinutesAgo = new Date(Date.now() - 59 * 60 * 1000);
    expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe('59m ago');
  });

  it('returns "1h ago" for timestamps exactly 1 hour ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatRelativeTime(oneHourAgo)).toBe('1h ago');
  });

  it('returns "Xh ago" for timestamps within the same day', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatRelativeTime(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns "yesterday" for timestamps from the previous day', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(yesterday)).toBe('yesterday');

    const yesterdayMorning = new Date(Date.now() - 30 * 60 * 60 * 1000);
    expect(formatRelativeTime(yesterdayMorning)).toBe('yesterday');
  });

  it('returns "Xd ago" for timestamps older than yesterday but within a week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');

    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(sixDaysAgo)).toBe('6d ago');
  });

  it('returns formatted date for timestamps older than a week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    // Should return formatted date like "Mar 28"
    expect(formatRelativeTime(twoWeeksAgo)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('handles future timestamps gracefully', () => {
    const futureDate = new Date(Date.now() + 60 * 1000);
    expect(formatRelativeTime(futureDate)).toBe('just now');
  });
});

describe('formatFullTimestamp', () => {
  it('returns a full formatted timestamp with date and time', () => {
    const date = new Date('2026-04-11T10:30:45.000Z');
    const result = formatFullTimestamp(date);

    // Should contain year
    expect(result).toMatch(/2026/);
    // Should contain time components (hour:minute:second format)
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    // Should contain AM or PM
    expect(result).toMatch(/AM|PM/);
  });

  it('formats timestamps with all required components', () => {
    const date = new Date('2026-04-11T09:15:30.000Z');
    const result = formatFullTimestamp(date);

    // Should be a non-empty string with expected format components
    expect(result.length).toBeGreaterThan(15);
    // Should contain a comma (date formatting)
    expect(result).toContain(',');
    // Should contain time with seconds
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
