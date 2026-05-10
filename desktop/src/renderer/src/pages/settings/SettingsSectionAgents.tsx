import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AgentDefinition } from '../../../../preload';
import {
  buildWriteAgentParams,
  formatToolsForInput,
  isValidAgentName,
  type AgentFormValues,
} from './agents-form-helpers';

type PinnedProject = { path: string; name: string };

type AgentEditorProps = {
  initial: AgentFormValues;
  projects: PinnedProject[];
  allowScopeChange: boolean;
  onCancel: () => void;
  onSave: (values: AgentFormValues) => Promise<void>;
  saveError: string | null;
  isSaving: boolean;
};

function AgentEditor({
  initial,
  projects,
  allowScopeChange,
  onCancel,
  onSave,
  saveError,
  isSaving,
}: AgentEditorProps): React.ReactElement {
  const [scope, setScope] = useState<'global' | 'project'>(initial.scope);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [model, setModel] = useState(initial.model);
  const [toolsInput, setToolsInput] = useState(initial.toolsInput);
  const [body, setBody] = useState(initial.body);
  const [baseDirectory, setBaseDirectory] = useState<string>(
    initial.baseDirectory ?? projects[0]?.path ?? '',
  );

  const nameValid = isValidAgentName(name);
  const descriptionValid = description.trim().length > 0;
  const projectValid = scope === 'global' || baseDirectory.trim().length > 0;
  const canSave = nameValid && descriptionValid && projectValid && !isSaving;

  return (
    <div className="mt-3 p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-3">
      <div className="flex gap-4 items-center">
        <span className="text-xs text-[var(--color-text-muted)]">Scope:</span>
        <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="radio"
            name="agent-scope"
            checked={scope === 'global'}
            disabled={!allowScopeChange}
            onChange={() => setScope('global')}
          />
          Global
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="radio"
            name="agent-scope"
            checked={scope === 'project'}
            disabled={!allowScopeChange}
            onChange={() => setScope('project')}
          />
          Project
        </label>
      </div>

      {scope === 'project' && (
        <div>
          <label
            htmlFor="agent-project-select"
            className="block text-xs text-[var(--color-text-muted)] mb-1"
          >
            Project Directory
          </label>
          {projects.length > 0 ? (
            <select
              id="agent-project-select"
              value={baseDirectory}
              onChange={(e) => setBaseDirectory(e.target.value)}
              className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-sm text-[var(--color-text)]"
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="agent-project-select"
              value={baseDirectory}
              onChange={(e) => setBaseDirectory(e.target.value)}
              placeholder="/absolute/path/to/project"
            />
          )}
        </div>
      )}

      <div>
        <label
          htmlFor="agent-name"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Name
        </label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-agent"
          aria-invalid={!nameValid}
        />
        {!nameValid && name.length > 0 && (
          <p className="text-xs text-[var(--color-error)] mt-1">
            Name must match [a-zA-Z0-9_-]+
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="agent-description"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Description
        </label>
        <Input
          id="agent-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One-line description"
          aria-invalid={!descriptionValid}
        />
      </div>

      <div>
        <label
          htmlFor="agent-model"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Model (optional)
        </label>
        <Input
          id="agent-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. anthropic/claude-sonnet-4"
        />
      </div>

      <div>
        <label
          htmlFor="agent-tools"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Tools (optional, comma-separated)
        </label>
        <Input
          id="agent-tools"
          value={toolsInput}
          onChange={(e) => setToolsInput(e.target.value)}
          placeholder="read, write, bash"
        />
      </div>

      <div>
        <label
          htmlFor="agent-body"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Content (markdown)
        </label>
        <textarea
          id="agent-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="w-full font-mono text-xs bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-2 text-[var(--color-text)]"
          placeholder="# Agent instructions..."
        />
      </div>

      {saveError && (
        <p className="text-xs text-[var(--color-error)]">{saveError}</p>
      )}

      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({
              scope,
              name,
              description,
              model,
              toolsInput,
              body,
              baseDirectory: scope === 'project' ? baseDirectory : undefined,
            })
          }
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type AgentListItemProps = {
  agent: AgentDefinition;
  onEdit: (agent: AgentDefinition) => void;
  onDelete: (agent: AgentDefinition) => void;
};

function AgentListItem({
  agent,
  onEdit,
  onDelete,
}: AgentListItemProps): React.ReactElement {
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
          {agent.overridden && (
            <span
              className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-warning,orange)]/20 text-[var(--color-warning,orange)]"
              title="Shadowed by a project-scoped agent with the same name"
            >
              overridden
            </span>
          )}
          {agent.editable === false && (
            <span
              className="text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-faint)]"
              title="This agent is provided by OpenCode and does not have a local markdown file Eden can edit."
            >
              read-only
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-faint)] truncate mt-0.5">
          {agent.description || '—'}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {agent.editable === false ? null : (
          <>
            <button
              type="button"
              onClick={() => onEdit(agent)}
              className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(agent)}
              className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY_FORM: AgentFormValues = {
  scope: 'global',
  name: '',
  description: '',
  model: '',
  toolsInput: '',
  body: '',
  baseDirectory: undefined,
};

export function AgentsSection(): React.ReactElement {
  const [projects, setProjects] = useState<PinnedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; filePath: string; initial: AgentFormValues }
    | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const { globalAgents, projectAgents } = useMemo(() => {
    const globals: AgentDefinition[] = [];
    const project: AgentDefinition[] = [];
    for (const a of agents) {
      if (a.scope === 'global') globals.push(a);
      else project.push(a);
    }
    return { globalAgents: globals, projectAgents: project };
  }, [agents]);

  const handleDelete = useCallback(
    async (agent: AgentDefinition) => {
      const confirmed = window.confirm(`Delete agent "${agent.name}"?`);
      if (!confirmed) return;
      try {
        const result = await window.api.deleteAgent(agent.filePath);
        if (result.ok) {
          setStatusMessage(`Deleted ${agent.name}`);
          await loadAgents();
        } else {
          setStatusMessage(`Delete failed: ${result.error}`);
        }
      } catch (e) {
        setStatusMessage(
          `Delete failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      setTimeout(() => setStatusMessage(null), 4000);
    },
    [loadAgents],
  );

  const handleEdit = useCallback((agent: AgentDefinition) => {
    setSaveError(null);
    setEditor({
      mode: 'edit',
      filePath: agent.filePath,
      initial: {
        scope: agent.scope,
        name: agent.name,
        description: agent.description,
        model: agent.model ?? '',
        toolsInput: formatToolsForInput(agent.tools),
        body: agent.body,
        baseDirectory: agent.baseDirectory,
      },
    });
  }, []);

  const handleNew = useCallback(() => {
    setSaveError(null);
    setEditor({ mode: 'create' });
  }, []);

  const handleSave = useCallback(
    async (values: AgentFormValues) => {
      setSaveError(null);
      setIsSaving(true);
      try {
        const params = buildWriteAgentParams(values);
        if (params.scope === 'project' && !params.baseDirectory) {
          setSaveError('Project scope requires a project directory.');
          return;
        }
        const result = await window.api.writeAgent(params);
        if (result.ok) {
          setStatusMessage(`Saved ${params.name}`);
          setEditor(null);
          await loadAgents();
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          setSaveError(result.error);
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSaving(false);
      }
    },
    [loadAgents],
  );

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="agents-project-select"
          className="block text-xs text-[var(--color-text-muted)] mb-1"
        >
          Project (for project-scoped agents)
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

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleNew}>
          New Agent
        </Button>
        {statusMessage && (
          <span className="text-xs text-[var(--color-text-faint)]">
            {statusMessage}
          </span>
        )}
      </div>

      {loadError && (
        <p className="text-xs text-[var(--color-error)]">{loadError}</p>
      )}

      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Global ({globalAgents.length})
        </h4>
        <div className="space-y-1">
          {globalAgents.length === 0 ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              No global agents.
            </p>
          ) : (
            globalAgents.map((a) => (
              <AgentListItem
                key={a.filePath}
                agent={a}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Project ({projectAgents.length})
        </h4>
        <div className="space-y-1">
          {selectedProject === '' ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              Select a project to see project-scoped agents.
            </p>
          ) : projectAgents.length === 0 ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              No project agents.
            </p>
          ) : (
            projectAgents.map((a) => (
              <AgentListItem
                key={a.filePath}
                agent={a}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>

      {editor && (
        <AgentEditor
          initial={
            editor.mode === 'create'
              ? {
                  ...EMPTY_FORM,
                  scope: selectedProject ? 'project' : 'global',
                  baseDirectory: selectedProject || undefined,
                }
              : editor.initial
          }
          projects={projects}
          allowScopeChange={editor.mode === 'create'}
          onCancel={() => setEditor(null)}
          onSave={handleSave}
          saveError={saveError}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
