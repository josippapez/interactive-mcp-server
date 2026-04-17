import React, { memo, useState, useRef, useEffect, useMemo } from 'react';

import type { AgentDefinition } from '../../../../preload';
import { Popover, PopoverContent, PopoverAnchor } from '../ui/popover';
import { filterAgents, groupAgentsByScope } from './agent-picker-filter';

interface AgentPopoverProps {
  /** Whether the popover is open */
  open: boolean;
  /** Close/open the popover */
  onOpenChange: (open: boolean) => void;
  /** Currently selected agent name, or null for the default agent */
  selectedAgent: string | null;
  /** Callback when an agent is selected (null = default) */
  onSelect: (agent: string | null) => void;
  /** Current base directory — agents are fetched for this directory */
  baseDirectory?: string;
}

/** Scope badge pill */
function ScopeBadge({
  scope,
}: {
  scope: 'project' | 'global';
}): React.ReactElement {
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
        scope === 'project'
          ? 'border-[var(--color-agent)]/40 text-[var(--color-agent)] bg-[var(--color-agent)]/10'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-surface-alt)]'
      }`}
    >
      {scope}
    </span>
  );
}

function AgentPopover({
  open,
  onOpenChange,
  selectedAgent,
  onSelect,
  baseDirectory,
}: AgentPopoverProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset search when closed
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [open]);

  // Fetch agents whenever the popover opens or baseDirectory changes while open
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await window.api.listAgents(baseDirectory);
        if (cancelled) return;
        if (result.ok) {
          setAgents(result.data);
        } else {
          setAgents([]);
          setError(result.error);
          window.api.log?.(
            'warn',
            'AgentPopover',
            `listAgents failed: ${result.error}`,
          );
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        window.api.log?.(
          'error',
          'AgentPopover',
          `listAgents threw: ${message}`,
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, baseDirectory]);

  // Filter + group
  const filtered = useMemo(
    () => filterAgents(agents, searchQuery),
    [agents, searchQuery],
  );
  const grouped = useMemo(() => groupAgentsByScope(filtered), [filtered]);

  // Flat list used for keyboard navigation: default first, then project, then global.
  type FlatItem =
    | { kind: 'default' }
    | { kind: 'agent'; agent: AgentDefinition };

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [{ kind: 'default' }];
    for (const a of grouped.project) items.push({ kind: 'agent', agent: a });
    for (const a of grouped.global) items.push({ kind: 'agent', agent: a });
    return items;
  }, [grouped]);

  // Clamp activeIndex whenever flatItems changes (e.g. search narrows the list)
  useEffect(() => {
    setActiveIndex((prev) => {
      if (flatItems.length === 0) return 0;
      if (prev >= flatItems.length) return flatItems.length - 1;
      if (prev < 0) return 0;
      return prev;
    });
  }, [flatItems.length]);

  const handleSelect = (agent: string | null): void => {
    onSelect(agent);
    onOpenChange(false);
    setSearchQuery('');
  };

  const selectItem = (item: FlatItem): void => {
    if (item.kind === 'default') {
      handleSelect(null);
    } else {
      handleSelect(item.agent.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      const item = flatItems[activeIndex];
      if (item) {
        e.preventDefault();
        selectItem(item);
      }
    }
  };

  // Shared row renderer for a specific agent.
  const renderAgentRow = (
    agent: AgentDefinition,
    flatIdx: number,
  ): React.ReactElement => {
    const isSelected = agent.name === selectedAgent;
    const isActive = flatIdx === activeIndex;
    return (
      <button
        key={`${agent.scope}:${agent.filePath}`}
        type="button"
        onClick={() => handleSelect(agent.name)}
        onMouseEnter={() => setActiveIndex(flatIdx)}
        className={`w-full px-2 py-1.5 text-left text-[11px] flex items-center justify-between gap-2 transition-colors ${
          isSelected
            ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
            : isActive
              ? 'bg-[var(--color-surface-alt)] text-[var(--color-text)]'
              : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
        }`}
      >
        <span className="flex flex-col min-w-0 flex-1">
          <span className="truncate font-medium">{agent.name}</span>
          {agent.description && (
            <span className="truncate text-[10px] text-[var(--color-text-faint)]">
              {agent.description}
            </span>
          )}
        </span>
        <ScopeBadge scope={agent.scope === 'project' ? 'project' : 'global'} />
      </button>
    );
  };

  // Build a map from agent filePath to flat index for quick lookup at render.
  const flatIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    flatItems.forEach((item, idx) => {
      if (item.kind === 'agent') {
        m.set(`${item.agent.scope}:${item.agent.filePath}`, idx);
      }
    });
    return m;
  }, [flatItems]);

  const defaultIsActive = activeIndex === 0;
  const defaultIsSelected = selectedAgent === null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="absolute left-0 bottom-0" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="min-w-[260px] max-w-[340px] p-0"
        onEscapeKeyDown={() => onOpenChange(false)}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="px-2 py-2 border-b border-[var(--color-border)]">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            aria-label="Search agents"
            className="w-full text-[11px] px-2 py-1.5 rounded-md bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none focus:border-[var(--color-agent)]/40"
          />
        </div>
        <div ref={listRef} className="max-h-[300px] overflow-y-auto">
          {/* Default option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            onMouseEnter={() => setActiveIndex(0)}
            className={`w-full px-2 py-1.5 text-left text-[11px] flex items-center justify-between gap-2 transition-colors border-b border-[var(--color-border)] ${
              defaultIsSelected
                ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : defaultIsActive
                  ? 'bg-[var(--color-surface-alt)] text-[var(--color-text)]'
                  : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <span className="flex flex-col min-w-0 flex-1">
              <span className="truncate font-medium">Default</span>
              <span className="truncate text-[10px] text-[var(--color-text-faint)]">
                No custom agent
              </span>
            </span>
          </button>

          {isLoading && (
            <div className="px-3 py-3 text-[11px] text-[var(--color-text-faint)] text-center">
              Loading agents…
            </div>
          )}

          {error && !isLoading && (
            <div className="px-3 py-2 text-[11px] text-[var(--color-danger,#c33)] border-b border-[var(--color-border)]">
              Failed to load agents: {error}
            </div>
          )}

          {!isLoading && !error && grouped.project.length > 0 && (
            <div>
              <div className="px-2 py-1.5 text-[10px] font-medium text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] sticky top-0">
                Project
              </div>
              {grouped.project.map((agent) => {
                const flatIdx =
                  flatIndexByKey.get(`${agent.scope}:${agent.filePath}`) ?? -1;
                return renderAgentRow(agent, flatIdx);
              })}
            </div>
          )}

          {!isLoading && !error && grouped.global.length > 0 && (
            <div>
              <div className="px-2 py-1.5 text-[10px] font-medium text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] sticky top-0">
                Global
              </div>
              {grouped.global.map((agent) => {
                const flatIdx =
                  flatIndexByKey.get(`${agent.scope}:${agent.filePath}`) ?? -1;
                return renderAgentRow(agent, flatIdx);
              })}
            </div>
          )}

          {!isLoading &&
            !error &&
            grouped.project.length === 0 &&
            grouped.global.length === 0 &&
            searchQuery.trim() && (
              <div className="px-3 py-3 text-[11px] text-[var(--color-text-faint)] text-center">
                No agents match &ldquo;{searchQuery}&rdquo;
              </div>
            )}

          {!isLoading &&
            !error &&
            agents.length === 0 &&
            !searchQuery.trim() && (
              <div className="px-3 py-3 text-[11px] text-[var(--color-text-faint)] text-center">
                No custom agents found
              </div>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default memo(AgentPopover);
