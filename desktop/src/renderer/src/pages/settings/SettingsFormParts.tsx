import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PREDEFINED_TOOLS, type AppSettings } from './settings-types';

export function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 pr-4">
        <label
          htmlFor={id}
          className="text-sm text-[var(--color-text-muted)] cursor-pointer"
        >
          {label}
        </label>
        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-[var(--color-agent)]' : 'bg-[var(--color-border)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  label,
  description,
  min,
  max,
  isValid,
  errorMessage,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  description: string;
  min?: number;
  max?: number;
  isValid: boolean;
  errorMessage?: string;
}): React.ReactElement {
  return (
    <div className="py-3">
      <label
        htmlFor={id}
        className="block text-sm text-[var(--color-text-muted)] mb-1"
      >
        {label}
      </label>
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        min={min}
        max={max}
        aria-invalid={!isValid}
        aria-describedby={`${id}-help`}
        className="w-32"
      />
      <p
        id={`${id}-help`}
        className="text-xs text-[var(--color-text-faint)] mt-1"
      >
        {description}
      </p>
      {!isValid && errorMessage && (
        <p className="text-xs text-[var(--color-error)] mt-1">{errorMessage}</p>
      )}
    </div>
  );
}

export function ToolExclusionsSection({
  settings,
  onUpdateExclusions,
}: {
  settings: AppSettings;
  onUpdateExclusions: (exclusions: string[]) => void;
}): React.ReactElement {
  const allTools = useMemo(() => {
    const combined = new Set([
      ...PREDEFINED_TOOLS,
      ...(settings.discoveredTools ?? []),
    ]);
    return Array.from(combined).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }, [settings.discoveredTools]);

  const exclusions = settings.toolAutoExpandExclusions ?? [];

  const toggleTool = useCallback(
    (toolName: string) => {
      if (exclusions.includes(toolName)) {
        onUpdateExclusions(exclusions.filter((t) => t !== toolName));
        return;
      }
      onUpdateExclusions([...exclusions, toolName]);
    },
    [exclusions, onUpdateExclusions],
  );

  return (
    <div className="py-3 border-t border-[var(--color-border)] mt-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm text-[var(--color-text-muted)]">
            Tool Auto-Expand Exclusions
          </span>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Tools checked here will stay collapsed even when "Expand All Tools"
            is enabled
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdateExclusions([])}
            className="text-[10px]"
          >
            Clear All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdateExclusions([...allTools])}
            className="text-[10px]"
          >
            Exclude All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-48 overflow-y-auto p-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
        {allTools.map((toolName) => {
          const isExcluded = exclusions.includes(toolName);
          const isPredefined = (PREDEFINED_TOOLS as readonly string[]).includes(
            toolName,
          );
          return (
            <label
              key={toolName}
              className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--color-border)]/30 cursor-pointer text-xs"
            >
              <input
                type="checkbox"
                checked={isExcluded}
                onChange={() => toggleTool(toolName)}
                className="w-3 h-3 rounded accent-[var(--color-agent)]"
              />
              <span
                className={
                  isExcluded
                    ? 'text-[var(--color-text-faint)] line-through'
                    : 'text-[var(--color-text-muted)]'
                }
              >
                {toolName}
              </span>
              {!isPredefined && (
                <span
                  className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]"
                  title="Discovered from conversation"
                >
                  new
                </span>
              )}
            </label>
          );
        })}
        {allTools.length === 0 && (
          <span className="col-span-full text-center text-[var(--color-text-faint)] text-xs py-2">
            No tools discovered yet
          </span>
        )}
      </div>

      {exclusions.length > 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
          {exclusions.length} tool{exclusions.length !== 1 ? 's' : ''} excluded
          from auto-expand
        </p>
      )}
    </div>
  );
}
