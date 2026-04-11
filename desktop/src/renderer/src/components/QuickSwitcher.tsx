import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import type { SessionNode, ProviderType } from '../types';

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

type Props = {
  open: boolean;
  onClose: () => void;
  connections: Map<string, SessionNode>;
  onSelectSession: (sessionId: string) => void;
  onNavigate: (tab: 'prompt' | 'skills' | 'settings') => void;
  onRefreshSessions: () => void;
  onCreateSkill: () => void;
  onCreateInstruction: () => void;
};

const PROVIDER_ICONS: Record<ProviderType, string> = {
  opencode: '⬡',
  'copilot-cli': '◇',
  'claude-sdk': '◆',
  standalone: '○',
};

const NAVIGATION_ITEMS: QuickSwitcherAction[] = [
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

const ACTION_ITEMS: QuickSwitcherAction[] = [
  {
    id: 'action-new-skill',
    type: 'action',
    label: 'New Skill',
    description: 'Create a new skill',
    icon: '+',
  },
  {
    id: 'action-new-instruction',
    type: 'action',
    label: 'New Instruction',
    description: 'Create a new instruction',
    icon: '+',
  },
  {
    id: 'action-refresh',
    type: 'action',
    label: 'Refresh Sessions',
    description: 'Reload session list from providers',
    icon: '↻',
  },
];

/**
 * Builds searchable actions from session nodes
 */
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

  return actions;
}

/**
 * Filters actions by search query
 */
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

/**
 * Groups actions by type for display
 */
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

const QuickSwitcher = memo(function QuickSwitcher({
  open,
  onClose,
  connections,
  onSelectSession,
  onNavigate,
  onRefreshSessions,
  onCreateSkill,
  onCreateInstruction,
}: Props): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build all available actions
  const allActions = useMemo(() => {
    const sessionActions = buildSessionActions(connections);
    // Sort sessions: pending prompts first, then alphabetically
    sessionActions.sort((a, b) => {
      if (a.hasPendingPrompt && !b.hasPendingPrompt) return -1;
      if (!a.hasPendingPrompt && b.hasPendingPrompt) return 1;
      return a.label.localeCompare(b.label);
    });
    return [...sessionActions, ...NAVIGATION_ITEMS, ...ACTION_ITEMS];
  }, [connections]);

  // Filter actions based on query
  const filteredActions = useMemo(
    () => filterActions(allActions, query),
    [allActions, query],
  );

  // Group filtered actions for display
  const groupedActions = useMemo(
    () => groupActions(filteredActions),
    [filteredActions],
  );

  // Flatten groups for keyboard navigation
  const flatActions = useMemo(() => {
    const flat: QuickSwitcherAction[] = [];
    // Order: sessions first, then navigation, then actions
    const order: QuickSwitcherAction['type'][] = [
      'session',
      'navigation',
      'action',
    ];
    for (const type of order) {
      const group = groupedActions.get(type);
      if (group) flat.push(...group);
    }
    return flat;
  }, [groupedActions]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a brief delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= flatActions.length) {
      setSelectedIndex(Math.max(0, flatActions.length - 1));
    }
  }, [flatActions.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (action: QuickSwitcherAction) => {
      switch (action.type) {
        case 'session': {
          const sessionId = action.id.replace('session-', '');
          onSelectSession(sessionId);
          onNavigate('prompt');
          break;
        }
        case 'navigation':
          if (action.id === 'nav-prompts') onNavigate('prompt');
          else if (action.id === 'nav-skills') onNavigate('skills');
          else if (action.id === 'nav-settings') onNavigate('settings');
          break;
        case 'action':
          if (action.id === 'action-refresh') onRefreshSessions();
          else if (action.id === 'action-new-skill') {
            onNavigate('skills');
            // Small delay to let the navigation complete
            setTimeout(() => onCreateSkill(), 100);
          } else if (action.id === 'action-new-instruction') {
            onNavigate('skills');
            setTimeout(() => onCreateInstruction(), 100);
          }
          break;
      }
      onClose();
    },
    [
      onSelectSession,
      onNavigate,
      onRefreshSessions,
      onCreateSkill,
      onCreateInstruction,
      onClose,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatActions.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatActions.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (flatActions[selectedIndex]) {
            handleSelect(flatActions[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatActions, selectedIndex, handleSelect, onClose],
  );

  if (!open) return null;

  const GROUP_LABELS: Record<QuickSwitcherAction['type'], string> = {
    session: 'Sessions',
    navigation: 'Navigation',
    action: 'Actions',
  };

  // Track cumulative index for keyboard navigation
  let cumulativeIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-sm w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-faint)]">❯</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search sessions, navigate, or run actions..."
              className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none"
            />
            <kbd className="px-1.5 py-0.5 rounded-sm bg-[var(--color-kbd-bg)] text-[var(--color-text-faint)] font-mono text-[10px]">
              ESC
            </kbd>
          </div>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto"
          role="listbox"
          aria-label="Quick switcher results"
        >
          {flatActions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              No results for "{query}"
            </div>
          ) : (
            (['session', 'navigation', 'action'] as const).map((type) => {
              const group = groupedActions.get(type);
              if (!group || group.length === 0) return null;

              const startIndex = cumulativeIndex;
              cumulativeIndex += group.length;

              return (
                <div key={type}>
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface-alt)]">
                    {GROUP_LABELS[type]}
                  </div>
                  {group.map((action, i) => {
                    const index = startIndex + i;
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={action.id}
                        type="button"
                        data-index={index}
                        onClick={() => handleSelect(action)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                            : 'text-[var(--color-text)] hover:bg-[var(--color-border)]'
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span
                          className={`w-5 text-center text-sm shrink-0 ${
                            action.hasPendingPrompt
                              ? 'text-[var(--color-user)]'
                              : 'text-[var(--color-text-faint)]'
                          }`}
                        >
                          {action.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm truncate">
                              {action.label}
                            </span>
                            {action.hasPendingPrompt && (
                              <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse shrink-0" />
                            )}
                          </div>
                          {action.description && (
                            <p className="text-xs text-[var(--color-text-faint)] truncate">
                              {action.description}
                            </p>
                          )}
                        </div>
                        {action.shortcut && (
                          <kbd className="px-1.5 py-0.5 rounded-sm bg-[var(--color-kbd-bg)] text-[var(--color-text-faint)] font-mono text-[10px] shrink-0">
                            {action.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center justify-center gap-4 text-[10px] text-[var(--color-text-faint)]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ↵
              </kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ESC
              </kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default QuickSwitcher;
