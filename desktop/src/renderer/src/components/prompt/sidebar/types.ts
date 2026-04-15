import type { ProviderType } from '../../../types';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';

export type ProviderFilter = 'all' | ProviderType;

/** Persisted collapsed state keys */
export const COLLAPSED_PROJECTS_KEY = 'sidebar-collapsed-projects';
export const COLLAPSED_SESSIONS_KEY = 'sidebar-collapsed-sessions';

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 280;

export const STATUS_DOT_CLASSES: Record<string, string> = {
  working: 'bg-[var(--color-user)] animate-pulse',
  success: 'bg-[var(--color-success)]',
  error: 'bg-[var(--color-error)]',
  info: 'bg-[var(--color-agent)]',
};

/** Session status from OpenCode API */
export const SESSION_STATUS_CLASSES: Record<SessionStatusType, string> = {
  busy: 'bg-amber-500 animate-pulse',
  idle: 'bg-emerald-500',
  error: 'bg-[var(--color-error)]',
  unknown: 'bg-gray-400',
};

export const SESSION_STATUS_LABELS: Record<SessionStatusType, string> = {
  busy: 'Working...',
  idle: 'Idle',
  error: 'Error',
  unknown: 'Unknown',
};

export const PROVIDER_LABELS: Record<ProviderFilter, string> = {
  all: 'All',
  opencode: 'OpenCode',
  'copilot-cli': 'Copilot',
  'claude-sdk': 'Claude',
  standalone: 'Other',
};

export const PROVIDER_ICONS: Record<ProviderFilter, string> = {
  all: '◎',
  opencode: '⬡',
  'copilot-cli': '◇',
  'claude-sdk': '◆',
  standalone: '○',
};
