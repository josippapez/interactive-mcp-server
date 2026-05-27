import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getStringField,
  hasManagedInteractiveDesktopKey,
  mergeCommonFields,
  safeParseJson,
  stringifyConfigPretty,
  type CommonFields,
} from './opencode-config-helpers';

type PinnedProject = { path: string; name: string };
type ConfigScope = 'global' | 'project';

export function OpenCodeConfigSection(): React.ReactElement {
  const [scope, setScope] = useState<ConfigScope>('global');
  const [projects, setProjects] = useState<PinnedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');

  const [rawText, setRawText] = useState<string>('{}');
  const [filePath, setFilePath] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pinned = await window.api.getPinnedProjects();
        if (cancelled) return;
        setProjects(pinned.map((p) => ({ path: p.path, name: p.name })));
        if (pinned.length > 0)
          setSelectedProject((cur) => cur || pinned[0].path);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            `Failed to load projects: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    setSaveStatus(null);
    try {
      if (scope === 'global') {
        const result = await window.api.readOpenCodeGlobalConfig();
        setFilePath(result.filePath);
        setRawText(stringifyConfigPretty(result.config));
        return;
      }
      if (!selectedProject) {
        setFilePath('');
        setRawText('{}');
        return;
      }
      const result =
        await window.api.readOpenCodeProjectConfig(selectedProject);
      setFilePath(result.filePath);
      setRawText(stringifyConfigPretty(result.config));
    } catch (e) {
      setLoadError(
        `Failed to load config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [scope, selectedProject]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const parseResult = useMemo(() => safeParseJson(rawText), [rawText]);

  const commonFields: CommonFields = useMemo(() => {
    const obj = parseResult.ok ? parseResult.value : null;
    return {
      model: getStringField(obj, 'model'),
      theme: getStringField(obj, 'theme'),
      provider: getStringField(obj, 'provider'),
    };
  }, [parseResult]);

  const managedKeyPresent = useMemo(
    () =>
      hasManagedInteractiveDesktopKey(
        parseResult.ok ? parseResult.value : null,
      ),
    [parseResult],
  );

  const updateCommonField = useCallback(
    (key: keyof CommonFields, value: string) => {
      if (!parseResult.ok) return;
      const merged = mergeCommonFields(parseResult.value, {
        ...commonFields,
        [key]: value,
      });
      setRawText(stringifyConfigPretty(merged));
    },
    [parseResult, commonFields],
  );

  const handleSave = useCallback(async () => {
    if (!parseResult.ok) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      if (scope === 'global') {
        const result = await window.api.writeOpenCodeGlobalConfig(
          parseResult.value,
        );
        setSaveStatus(`Saved to ${result.filePath}`);
      } else {
        if (!selectedProject) {
          setSaveStatus('Select a project first.');
          return;
        }
        const result = await window.api.writeOpenCodeProjectConfig(
          selectedProject,
          parseResult.value,
        );
        setSaveStatus(`Saved to ${result.filePath}`);
      }
      await loadConfig();
    } catch (e) {
      setSaveStatus(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 5000);
    }
  }, [parseResult, scope, selectedProject, loadConfig]);

  const canSave =
    parseResult.ok && !isSaving && (scope === 'global' || !!selectedProject);

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <span className="text-xs text-[var(--color-text-muted)]">Scope:</span>
        <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="radio"
            name="opencode-config-scope"
            checked={scope === 'global'}
            onChange={() => setScope('global')}
          />
          Global (~/.config/opencode/opencode.json)
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="radio"
            name="opencode-config-scope"
            checked={scope === 'project'}
            onChange={() => setScope('project')}
          />
          Project (.opencode/opencode.jsonc)
        </label>
      </div>

      {scope === 'project' && (
        <div>
          <label
            htmlFor="opencode-config-project"
            className="block text-xs text-[var(--color-text-muted)] mb-1"
          >
            Project
          </label>
          {projects.length > 0 ? (
            <select
              id="opencode-config-project"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-sm text-[var(--color-text)]"
            >
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="opencode-config-project"
              value={selectedProject}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedProject(e.target.value)
              }
              placeholder="/absolute/path/to/project"
            />
          )}
        </div>
      )}

      {filePath && (
        <p className="text-[10px] font-mono text-[var(--color-text-faint)]">
          {filePath}
        </p>
      )}

      {loadError && (
        <p className="text-xs text-[var(--color-error)]">{loadError}</p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-[var(--color-text)]">
          Common fields
        </h4>
        <div>
          <label
            htmlFor="opencode-config-model"
            className="block text-xs text-[var(--color-text-muted)] mb-1"
          >
            model
          </label>
          <Input
            id="opencode-config-model"
            value={commonFields.model}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateCommonField('model', e.target.value)
            }
            placeholder="anthropic/claude-sonnet-4"
            disabled={!parseResult.ok}
          />
        </div>
        <div>
          <label
            htmlFor="opencode-config-theme"
            className="block text-xs text-[var(--color-text-muted)] mb-1"
          >
            theme
          </label>
          <Input
            id="opencode-config-theme"
            value={commonFields.theme}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateCommonField('theme', e.target.value)
            }
            placeholder="system"
            disabled={!parseResult.ok}
          />
        </div>
        <div>
          <label
            htmlFor="opencode-config-provider"
            className="block text-xs text-[var(--color-text-muted)] mb-1"
          >
            provider
          </label>
          <Input
            id="opencode-config-provider"
            value={commonFields.provider}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateCommonField('provider', e.target.value)
            }
            placeholder="anthropic"
            disabled={!parseResult.ok}
          />
        </div>
      </div>

      {managedKeyPresent && (
        <div className="p-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <p className="text-xs text-[var(--color-text-muted)]">
            <span className="font-mono">
              mcp[&quot;interactive-desktop&quot;]
            </span>{' '}
            is present and managed by the app — cannot be edited here. It will
            be preserved on save.
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="opencode-config-raw"
          className="block text-sm font-medium text-[var(--color-text)] mb-1"
        >
          Raw JSON (source of truth)
        </label>
        <textarea
          id="opencode-config-raw"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={16}
          className="w-full font-mono text-xs bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-2 text-[var(--color-text)]"
          aria-invalid={!parseResult.ok}
        />
        {!parseResult.ok && (
          <p className="text-xs text-[var(--color-error)] mt-1">
            {parseResult.error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!canSave}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadConfig()}
          disabled={isSaving}
        >
          Reload
        </Button>
        {saveStatus && (
          <span className="text-xs text-[var(--color-text-faint)]">
            {saveStatus}
          </span>
        )}
      </div>
    </div>
  );
}
