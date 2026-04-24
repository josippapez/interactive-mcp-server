import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  OTHER_OPTION_VALUE,
  resolveSelectValue,
  toProjectOptions,
  type PinnedProject,
  type ProjectOption,
} from './project-picker-helpers';

export interface ProjectPickerProps {
  /** Current selected directory (absolute path). */
  value: string;
  /** Called whenever the effective value changes. */
  onChange: (dir: string) => void;
  /** Whether to show the "Other…" free-text escape hatch. Default: true. */
  allowFreeText?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Dropdown that lists pinned projects from `window.api.getPinnedProjects()`.
 *
 * If `allowFreeText` is not explicitly disabled, an "Other…" option is
 * appended which reveals a plain text input so the user can type any path.
 *
 * All derivation logic (normalising pinned entries, picking the `<select>`
 * value) lives in `project-picker-helpers.ts` and is unit tested there.
 */
export function ProjectPicker({
  value,
  onChange,
  allowFreeText = true,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ProjectPickerProps): React.ReactElement {
  const [pinned, setPinned] = useState<PinnedProject[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = window.api?.getPinnedProjects;
    if (typeof api !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const load = () => {
      api()
        .then((list) => {
          if (cancelled) return;
          setPinned(list ?? []);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : String(e);
          setLoadError(msg);
        });
    };

    load();

    // Re-fetch whenever the main process broadcasts a pinned-projects change
    // (e.g. user pins a new folder from Settings or the sidebar rail).
    const unsubscribe = window.api?.onPinnedProjectsUpdated?.(load);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const options: ProjectOption[] = useMemo(
    () => toProjectOptions(pinned),
    [pinned],
  );

  const selectValue = useMemo(
    () => resolveSelectValue(value, options),
    [value, options],
  );

  // Reveal the text field whenever the effective selection is the "Other…"
  // sentinel — this covers both "user picked Other…" and "current value isn't
  // one of the pinned paths".
  const showFreeText = allowFreeText && selectValue === OTHER_OPTION_VALUE;

  const handleSelectChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const next = e.target.value;
    if (next === OTHER_OPTION_VALUE) {
      // Clear value so the text input starts blank; parent can overwrite it.
      onChange('');
      return;
    }
    onChange(next);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value);
  };

  const selectClass =
    'w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-50';
  const inputClass = selectClass;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <select
        aria-label={ariaLabel ?? 'Project directory'}
        className={selectClass}
        value={selectValue}
        disabled={disabled}
        onChange={handleSelectChange}
      >
        <option value="" disabled>
          Select a project…
        </option>
        {options.map((opt) => (
          <option key={opt.path} value={opt.path}>
            {opt.label}
          </option>
        ))}
        {allowFreeText && <option value={OTHER_OPTION_VALUE}>Other…</option>}
      </select>
      {showFreeText && (
        <input
          type="text"
          aria-label={`${ariaLabel ?? 'Project directory'} (custom path)`}
          placeholder="/absolute/path/to/project"
          className={inputClass}
          value={value}
          disabled={disabled}
          onChange={handleTextChange}
        />
      )}
      {loadError && (
        <p
          role="alert"
          className="text-xs text-[var(--color-error)] leading-none"
        >
          Failed to load pinned projects: {loadError}
        </p>
      )}
    </div>
  );
}

export default ProjectPicker;
