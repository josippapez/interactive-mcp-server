import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './types';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'prompt-sidebar-width';

export function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export function parseStoredSidebarWidth(value: string | null): number {
  if (!value) return DEFAULT_SIDEBAR_WIDTH;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;

  const clamped = clampSidebarWidth(parsed);
  return clamped === parsed ? parsed : DEFAULT_SIDEBAR_WIDTH;
}
