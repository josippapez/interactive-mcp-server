import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { AgentDefinition } from '../../../../preload';

type PinnedProject = { path: string; name: string };

type AgentListItemProps = {
  agent: AgentDefinition;
};

function AgentListItem({ agent }: AgentListItemProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-2 px-3 py-2 rounded bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text)] truncate">
            {agent.name}
          </span>
          <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]">
            {agent.scope}
          </span>
          {agent.model && (
            <span className="text-[10px] text-[var(--color-text-faint)] font-mono truncate">
              {agent.model}
            </span>
          )}
          {agent.native && (
            <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-faint)]">
              native
            </span>
          )}
          {agent.hidden && (
            <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-faint)]">
              hidden
            </span>
          )}
          <span
            className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-faint)]"
            title="This agent is provided by OpenCode's SDK and is managed by OpenCode."
          >
            read-only
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-faint)] truncate mt-0.5">
          {agent.description || '—'}
        </p>
      </div>
    </div>
  );
}

export function AgentsSection(): React.ReactElement {
  const [projects, setProjects] = useState<PinnedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const pinned = await window.api.getPinnedProjects();
      setProjects(pinned.map((p) => ({ path: p.path, name: p.name })));
      if (pinned.length > 0 && selectedProject === '') {
        setSelectedProject(pinned[0].path);
      }
    } catch (e) {
      setLoadError(
        `Failed to load projects: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [selectedProject]);

  const loadAgents = useCallback(async () => {
    setLoadError(null);
    try {
      const baseDir = selectedProject.trim() || undefined;
      const result = await window.api.listAgents(baseDir);
      if (result.ok) {
        setAgents(result.data);
      } else {
        setLoadError(result.error);
      }
    } catch (e) {
      setLoadError(
        `Failed to list agents: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [selectedProject]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="agents-project-select"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Project context
        </label>
        {projects.length > 0 ? (
          <select
            id="agents-project-select"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-sm text-[var(--color-text)]"
          >
            <option value="">— No project selected —</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name} — {p.path}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="agents-project-select"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            placeholder="/absolute/path/to/project"
          />
        )}
      </div>

      <p className="text-xs text-[var(--color-text-faint)]">
        Agents are listed from OpenCode's SDK. Eden no longer scans or manages
        agent markdown files directly.
      </p>

      {loadError && (
        <p className="text-xs text-[var(--color-error)]">{loadError}</p>
      )}

      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Agents ({agents.length})
        </h4>
        <div className="space-y-1">
          {agents.length === 0 ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              No agents.
            </p>
          ) : (
            agents.map((agent) => (
              <AgentListItem key={agent.filePath} agent={agent} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
