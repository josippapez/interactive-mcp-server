import type { ProviderType, SessionNode } from '../types';

export type QuickSwitcherAction = {
  id: string;
  type: 'session' | 'navigation' | 'action';
  label: string;
  description?: string;
  shortcut?: string;
  icon?: string;
  providerType?: ProviderType | null;
  hasPendingPrompt?: boolean;
};

const PROVIDER_ICONS: Record<ProviderType, string> = {
  opencode: '⬡',
  'copilot-cli': '◇',
  'claude-sdk': '◆',
  standalone: '○',
};

export const NAVIGATION_ITEMS: QuickSwitcherAction[] = [
  {
    id: 'nav-prompts',
    type: 'navigation',
    label: 'Go to Prompts',
    description: 'View agent prompts and messages',
    shortcut: '⌘1',
    icon: '❯',
  },
  {
    id: 'nav-skills',
    type: 'navigation',
    label: 'Go to Skills',
    description: 'Manage skills and instructions',
    shortcut: '⌘2',
    icon: '✦',
  },
  {
    id: 'nav-settings',
    type: 'navigation',
    label: 'Go to Settings',
    description: 'Configure app preferences',
    shortcut: '⌘3',
    icon: '⚙',
  },
];

export const ACTION_ITEMS: QuickSwitcherAction[] = [
  {
    id: 'action-refresh',
    type: 'action',
    label: 'Refresh Sessions',
    description: 'Reload session list from providers',
    icon: '↻',
  },
];

export const GROUP_LABELS: Record<QuickSwitcherAction['type'], string> = {
  session: 'Sessions',
  navigation: 'Navigation',
  action: 'Actions',
};

export function buildSessionActions(
  connections: Map<string, SessionNode>,
): QuickSwitcherAction[] {
  const actions: QuickSwitcherAction[] = [];

  for (const [id, node] of connections) {
    const label = node.sessionChannel?.label ?? node.title;
    actions.push({
      id: `session-${id}`,
      type: 'session',
      label,
      description: node.directory || undefined,
      providerType: node.providerType,
      hasPendingPrompt: node.hasPendingPrompt,
      icon: node.providerType ? PROVIDER_ICONS[node.providerType] : '○',
    });
  }

  actions.sort((a, b) => {
    if (a.hasPendingPrompt && !b.hasPendingPrompt) return -1;
    if (!a.hasPendingPrompt && b.hasPendingPrompt) return 1;
    return a.label.localeCompare(b.label);
  });

  return actions;
}

export function filterActions(
  actions: QuickSwitcherAction[],
  query: string,
): QuickSwitcherAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return actions;

  return actions.filter(
    (action) =>
      action.label.toLowerCase().includes(q) ||
      action.description?.toLowerCase().includes(q),
  );
}

export function groupActions(
  actions: QuickSwitcherAction[],
): Map<QuickSwitcherAction['type'], QuickSwitcherAction[]> {
  const groups = new Map<QuickSwitcherAction['type'], QuickSwitcherAction[]>();

  for (const action of actions) {
    const existing = groups.get(action.type) ?? [];
    existing.push(action);
    groups.set(action.type, existing);
  }

  return groups;
}
