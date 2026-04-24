import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from './sidebar-resize';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './types';

describe('sidebar-resize', () => {
  it('clamps widths to configured min and max', () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 50)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 50)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(320)).toBe(320);
  });

  it('parses persisted widths safely', () => {
    expect(parseStoredSidebarWidth('340')).toBe(340);
    expect(parseStoredSidebarWidth(String(MIN_SIDEBAR_WIDTH - 1))).toBe(
      DEFAULT_SIDEBAR_WIDTH,
    );
    expect(parseStoredSidebarWidth('not-a-number')).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseStoredSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('uses a stable storage key', () => {
    expect(SIDEBAR_WIDTH_STORAGE_KEY).toBe('prompt-sidebar-width');
  });
});
