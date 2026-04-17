import { useCallback, memo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ACTION_ITEMS,
  GROUP_LABELS,
  NAVIGATION_ITEMS,
  type QuickSwitcherAction,
} from './QuickSwitcher.actions';
import { useSessionGraphSelector } from '../store/session-graph';

type Props = {
  open: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onNavigate: (tab: 'prompt' | 'skills' | 'settings') => void;
  onRefreshSessions: () => void;
};

const QuickSwitcher = memo(function QuickSwitcher({
  open,
  onClose,
  onSelectSession,
  onNavigate,
  onRefreshSessions,
}: Props): React.ReactElement {
  const sessionActions = useSessionGraphSelector(
    (state) => state.quickSwitcherActions,
  );

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
          break;
      }
      onClose();
    },
    [onSelectSession, onNavigate, onRefreshSessions, onClose],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
      title="Quick Switcher"
      description="Search sessions, navigate, or run actions"
    >
      <CommandInput placeholder="Search sessions, navigate, or run actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Sessions Group */}
        {sessionActions.length > 0 && (
          <CommandGroup heading={GROUP_LABELS.session}>
            {sessionActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`${action.label} ${action.description ?? ''}`}
                onSelect={() => handleSelect(action)}
                className="flex items-center gap-3"
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
                    <span className="text-sm truncate">{action.label}</span>
                    {action.hasPendingPrompt && (
                      <span className="w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse shrink-0" />
                    )}
                  </div>
                  {action.description && (
                    <p className="text-xs text-[var(--muted-foreground)] truncate">
                      {action.description}
                    </p>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Navigation Group */}
        <CommandGroup heading={GROUP_LABELS.navigation}>
          {NAVIGATION_ITEMS.map((action) => (
            <CommandItem
              key={action.id}
              value={`${action.label} ${action.description ?? ''}`}
              onSelect={() => handleSelect(action)}
              className="flex items-center gap-3"
            >
              <span className="w-5 text-center text-sm shrink-0 text-[var(--color-text-faint)]">
                {action.icon}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate">{action.label}</span>
                {action.description && (
                  <p className="text-xs text-[var(--muted-foreground)] truncate">
                    {action.description}
                  </p>
                )}
              </div>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Actions Group */}
        <CommandGroup heading={GROUP_LABELS.action}>
          {ACTION_ITEMS.map((action) => (
            <CommandItem
              key={action.id}
              value={`${action.label} ${action.description ?? ''}`}
              onSelect={() => handleSelect(action)}
              className="flex items-center gap-3"
            >
              <span className="w-5 text-center text-sm shrink-0 text-[var(--color-text-faint)]">
                {action.icon}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate">{action.label}</span>
                {action.description && (
                  <p className="text-xs text-[var(--muted-foreground)] truncate">
                    {action.description}
                  </p>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
});

export default QuickSwitcher;
