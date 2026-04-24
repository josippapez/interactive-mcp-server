import React, { memo } from 'react';
import type { ToolCallInfo } from '../../../types/unified-message';
import { useMessageCopy } from '../useMessageCopy';
import { useSettings, useUpdateSettings } from '../../../store';
import {
  getToolCallLabelTextClass,
  getToolCallMonoTextClass,
} from '../chat-text-size';

/**
 * Shared inline quarter-arc spinner. Used by `TaskToolCard` and by the
 * `running` state of `ToolStatusBadge` so every "in-flight" indicator
 * looks identical.
 */
export const ToolSpinner = memo(function ToolSpinner({
  className,
  size = 10,
}: {
  className?: string;
  size?: number;
}): React.ReactElement {
  return (
    <svg
      data-slot="tool-spinner"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`animate-spin shrink-0 ${className ?? ''}`.trim()}
      aria-hidden="true"
    >
      <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" />
    </svg>
  );
});

const STATUS_PILL_BASE =
  'inline-flex items-center rounded-full px-1.5 py-0.5 text-[calc(var(--chat-message-size,13px)-2px)] font-medium uppercase tracking-wide shrink-0';

export const TOOL_CALL_LABEL_TEXT_CLASS = getToolCallLabelTextClass();
export const TOOL_CALL_MONO_TEXT_CLASS = getToolCallMonoTextClass();

/**
 * Status indicator rendered inside the tool-trigger row.
 *
 *   - `pending`   → 1.5px pulse dot (agent color)
 *   - `running`   → shared `ToolSpinner` (agent color)
 *   - `completed` → compact "Done" pill (success surface + success text)
 *   - `error`     → compact "Error" pill (error surface + error text)
 */
export const ToolStatusBadge = memo(function ToolStatusBadge({
  status,
}: {
  status?: 'pending' | 'running' | 'completed' | 'error';
}): React.ReactElement | null {
  if (status === 'pending') {
    return (
      <span
        aria-label="Pending"
        className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-agent)] animate-pulse shrink-0"
      />
    );
  }
  if (status === 'running') {
    return (
      <span
        aria-label="Running"
        className="inline-flex items-center text-[var(--color-agent)] shrink-0"
      >
        <ToolSpinner />
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span
        className={`${STATUS_PILL_BASE} bg-[var(--color-success-surface)] text-[var(--color-success)]`}
      >
        Done
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className={`${STATUS_PILL_BASE} bg-[var(--color-error-surface)] text-[var(--color-error)]`}
      >
        Error
      </span>
    );
  }
  return null;
});

export function getToolInputSummary(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string | null {
  if (!input) return null;

  const pathFields = [
    'filePath',
    'path',
    'file',
    'directory',
    'dir',
    'workdir',
  ];
  const commandFields = ['command', 'cmd', 'script'];
  const queryFields = ['query', 'pattern', 'search', 'name', 'description'];
  const urlFields = ['url', 'uri', 'endpoint'];

  for (const field of pathFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  for (const field of commandFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const cmd = input[field] as string;
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
  }

  for (const field of queryFields) {
    if (typeof input[field] === 'string' && input[field]) {
      const query = input[field] as string;
      return query.length > 50 ? query.slice(0, 47) + '...' : query;
    }
  }

  for (const field of urlFields) {
    if (typeof input[field] === 'string' && input[field]) {
      return input[field] as string;
    }
  }

  if (
    toolName.toLowerCase().includes('todo') &&
    Array.isArray(input['todos'])
  ) {
    return `${input['todos'].length} items`;
  }

  return null;
}

export function formatInputCompact(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '';

  return entries
    .map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'string') {
        displayValue = value.length > 100 ? value.slice(0, 97) + '...' : value;
      } else if (Array.isArray(value)) {
        displayValue = `[${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        displayValue = '{...}';
      } else {
        displayValue = String(value);
      }
      return `${key}: ${displayValue}`;
    })
    .join('\n');
}

/**
 * Split a file path into directory and filename parts so CSS can
 * RTL-truncate the directory and keep the filename fully visible.
 *
 * `"src/renderer/src/foo.tsx"` → `{ directory: "src/renderer/src/", filename: "foo.tsx" }`
 * `"foo.tsx"` → `{ directory: "", filename: "foo.tsx" }`
 */
export function splitPath(path: string): {
  directory: string;
  filename: string;
} {
  const trimmed = path.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash === -1) {
    return { directory: '', filename: trimmed };
  }
  return {
    directory: trimmed.slice(0, lastSlash + 1),
    filename: trimmed.slice(lastSlash + 1),
  };
}

/**
 * +N / -N counters plus the 5-block visual bar summary used beside
 * file paths in edit/apply_patch/diff-view triggers.
 *
 * The 5 blocks are proportional: up to 5 slots filled with an add or
 * delete bar (add first, then delete), the rest are neutral. This
 * mirrors `~/Desktop/opencode/packages/ui/src/components/diff-changes.css`.
 *
 * CSS lives at main.css `[data-component='diff-changes']`.
 */
const DIFF_BAR_SLOTS = 5;

export const DiffChanges = memo(function DiffChanges({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.ReactElement {
  const total = additions + deletions;
  // Decide how many of the 5 slots are "add" vs "delete" vs "empty".
  let addSlots = 0;
  let deleteSlots = 0;
  if (total > 0) {
    const addRatio = additions / total;
    addSlots = Math.round(addRatio * DIFF_BAR_SLOTS);
    if (additions > 0 && addSlots === 0) addSlots = 1;
    if (deletions > 0 && addSlots === DIFF_BAR_SLOTS) {
      addSlots = DIFF_BAR_SLOTS - 1;
    }
    deleteSlots = Math.min(
      DIFF_BAR_SLOTS - addSlots,
      deletions > 0 ? Math.max(1, DIFF_BAR_SLOTS - addSlots) : 0,
    );
  }
  const emptySlots = DIFF_BAR_SLOTS - addSlots - deleteSlots;

  // 18x14 SVG with 5 vertical bars, each 2px wide, 2px gap, centered.
  const barWidth = 2;
  const barGap = 2;
  const barHeight = 10;
  const y = 2;
  const totalWidth = DIFF_BAR_SLOTS * barWidth + (DIFF_BAR_SLOTS - 1) * barGap;
  const startX = (18 - totalWidth) / 2;

  const bars: React.ReactElement[] = [];
  for (let i = 0; i < DIFF_BAR_SLOTS; i += 1) {
    const x = startX + i * (barWidth + barGap);
    let slot: 'diff-bar-add' | 'diff-bar-delete' | 'diff-bar-empty';
    if (i < addSlots) {
      slot = 'diff-bar-add';
    } else if (i < addSlots + deleteSlots) {
      slot = 'diff-bar-delete';
    } else {
      slot = 'diff-bar-empty';
    }
    bars.push(
      <rect
        key={i}
        x={x}
        y={y}
        width={barWidth}
        height={barHeight}
        rx={0.5}
        data-slot={slot}
      />,
    );
  }
  void emptySlots; // intentionally unused; loop above covers all slots

  return (
    <span
      data-component="diff-changes"
      aria-label={`+${additions} -${deletions}`}
    >
      <span data-slot="diff-add-count">+{additions}</span>
      <span data-slot="diff-delete-count">-{deletions}</span>
      <svg
        data-slot="diff-bars"
        viewBox="0 0 18 14"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {bars}
      </svg>
    </span>
  );
});

/**
 * Hover-reveal copy button for bash/diff bodies. The parent container
 * styles opacity via `:hover [data-slot='bash-copy']`. Pass `slot` to
 * match the expected selector (default: `bash-copy`, which also covers
 * diff-copy since that selector is aliased in CSS).
 *
 * Click behavior toggles a short-lived "Copied" label; on failure we
 * silently fall back to the idle label.
 */
/**
 * Chevron rendered at the right of a tool trigger row. CSS rotates it
 * 90° when the trigger carries `data-state='open'`. Mirrors the private
 * `ToolChevron` in `DefaultToolCard.tsx`.
 */
export const ToolChevron = memo(function ToolChevron(): React.ReactElement {
  return (
    <svg
      data-slot="tool-chevron"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 3 8 6l-3.5 3" />
    </svg>
  );
});

/**
 * Format a millisecond duration as a compact human-readable string.
 *
 *   - `< 1000`  → `"850ms"`
 *   - `< 60000` → `"3.2s"`
 *   - else      → `"2m17s"`
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m${seconds}s`;
}

/**
 * Resolve a tool-call duration in milliseconds. Prefers the authoritative
 * SDK timing (`state.time.start` / `state.time.end` — surfaced by the
 * main-process event bridge as `tool.startedAt` / `tool.completedAt`).
 *
 * Falls back to a legacy `metadata.durationMs` field (set by some
 * opencode tools directly on metadata) so backward compatibility is
 * preserved for cards that previously read from metadata.
 *
 * Returns `null` when neither source yields a usable value or when the
 * tool is still running.
 */
export function getToolDurationMs(tool: ToolCallInfo): number | null {
  if (
    typeof tool.startedAt === 'number' &&
    typeof tool.completedAt === 'number' &&
    tool.completedAt >= tool.startedAt
  ) {
    return tool.completedAt - tool.startedAt;
  }
  const metaDuration = tool.metadata?.durationMs;
  if (typeof metaDuration === 'number' && Number.isFinite(metaDuration)) {
    return metaDuration;
  }
  return null;
}

/**
 * Small inline duration badge. Renders nothing when no duration is
 * resolvable (e.g., still running without a completedAt). Matches the
 * lightweight inline pill style used by the Bash trigger row so every
 * card displays duration consistently.
 */
export const ToolDurationBadge = memo(function ToolDurationBadge({
  tool,
  className,
}: {
  tool: ToolCallInfo;
  className?: string;
}): React.ReactElement | null {
  const ms = getToolDurationMs(tool);
  if (ms === null) return null;
  const base =
    'text-[calc(var(--chat-message-size,13px)-2px)] text-[var(--text-weak)] font-mono shrink-0 tabular-nums';
  return (
    <span className={className ? `${base} ${className}` : base}>
      {formatDuration(ms)}
    </span>
  );
});

/**
 * Extract the hostname from a URL string; falls back to the raw input
 * when the URL cannot be parsed. Duplicates the private helper in
 * `tool-registry.ts` so cards can use it without reaching into that
 * module.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Single LSP diagnostic entry, matching the VSCode `Diagnostic` shape
 * produced by opencode's tool/edit.ts + tool/write.ts (via
 * `LSP.Diagnostic`). All fields are optional from our perspective —
 * we only render what's present.
 */
export interface LspDiagnostic {
  /** 1=Error, 2=Warning, 3=Info, 4=Hint */
  severity?: number;
  message?: string;
  source?: string;
  code?: string | number;
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
}

/**
 * Extract diagnostics for a given file path from a tool's `metadata`.
 * The edit/write tools emit `metadata.diagnostics` as
 * `Record<normalizedFilepath, Diagnostic[]>`. Paths inside the record
 * are normalized (absolute), so we try a direct lookup first and then
 * fall back to a suffix match on the bare filename so we're resilient
 * to relative-vs-absolute mismatches.
 */
export function extractDiagnosticsForFile(
  metadata: Record<string, unknown> | undefined,
  filePath: string,
): LspDiagnostic[] {
  if (!metadata || !filePath) return [];
  const raw = metadata['diagnostics'];
  if (!raw || typeof raw !== 'object') return [];
  const map = raw as Record<string, unknown>;

  const direct = map[filePath];
  if (Array.isArray(direct)) return direct as LspDiagnostic[];

  for (const [key, value] of Object.entries(map)) {
    if (
      Array.isArray(value) &&
      (key.endsWith(filePath) || filePath.endsWith(key))
    ) {
      return value as LspDiagnostic[];
    }
  }
  return [];
}

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  total: number;
}

export function countDiagnostics(
  diagnostics: readonly LspDiagnostic[],
): DiagnosticCounts {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let hints = 0;
  for (const d of diagnostics) {
    switch (d.severity) {
      case 1:
        errors += 1;
        break;
      case 2:
        warnings += 1;
        break;
      case 3:
        infos += 1;
        break;
      case 4:
        hints += 1;
        break;
      default:
        // Unknown severity — count as a warning to err on the side of
        // surfacing it.
        warnings += 1;
    }
  }
  return { errors, warnings, infos, hints, total: diagnostics.length };
}

/**
 * Compact pill summarising LSP diagnostics on a file-tool card. Shows
 * the error count in the error surface, and the warning count in the
 * warn surface when present. Renders nothing for empty diagnostics.
 */
export const DiagnosticsBadge = memo(function DiagnosticsBadge({
  counts,
}: {
  counts: DiagnosticCounts;
}): React.ReactElement | null {
  if (counts.total === 0) return null;
  return (
    <span
      data-component="diagnostics-badge"
      className="inline-flex items-center gap-1 shrink-0"
      aria-label={`${counts.errors} error${counts.errors === 1 ? '' : 's'}, ${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`}
    >
      {counts.errors > 0 && (
        <span
          className={`${STATUS_PILL_BASE} bg-[var(--color-error-surface)] text-[var(--color-error)]`}
        >
          {counts.errors} err
        </span>
      )}
      {counts.warnings > 0 && (
        <span
          className={`${STATUS_PILL_BASE} bg-[var(--color-warning-surface,var(--color-error-surface))] text-[var(--color-warning,var(--color-error))]`}
        >
          {counts.warnings} warn
        </span>
      )}
    </span>
  );
});

const SEVERITY_LABEL: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

/**
 * Expandable list of LSP diagnostics for a file, rendered inside a
 * tool card's collapsible content area.
 */
export const DiagnosticsList = memo(function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: readonly LspDiagnostic[];
}): React.ReactElement | null {
  if (diagnostics.length === 0) return null;
  return (
    <ul
      data-component="diagnostics-list"
      className={`flex flex-col gap-1 font-mono ${TOOL_CALL_MONO_TEXT_CLASS}`}
    >
      {diagnostics.map((d, i) => {
        const line = d.range?.start?.line;
        const col = d.range?.start?.character;
        const severity = SEVERITY_LABEL[d.severity ?? 0] ?? 'warning';
        const location =
          typeof line === 'number'
            ? `${line + 1}${typeof col === 'number' ? `:${col + 1}` : ''}`
            : null;
        return (
          <li
            key={i}
            data-slot="diagnostic-item"
            data-severity={severity}
            className="flex items-baseline gap-2"
          >
            <span
              data-slot="diagnostic-severity"
              className={
                severity === 'error'
                  ? 'text-[var(--color-error)]'
                  : 'text-[var(--color-warning,var(--color-error))]'
              }
            >
              {severity}
            </span>
            {location && (
              <span className="text-[var(--text-weak)] tabular-nums">
                {location}
              </span>
            )}
            <span className="text-[var(--text-strong)] break-words">
              {d.message ?? ''}
            </span>
            {d.source && (
              <span className="text-[var(--text-weak)]">({d.source})</span>
            )}
          </li>
        );
      })}
    </ul>
  );
});

export const CopyButton = memo(function CopyButton({
  text,
  slot = 'bash-copy',
  label = 'Copy',
  copiedLabel = 'Copied',
  className,
}: {
  text: string;
  slot?: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}): React.ReactElement {
  const { copied, copy } = useMessageCopy();
  return (
    <button
      type="button"
      data-slot={slot}
      onClick={(e) => {
        e.stopPropagation();
        void copy(text);
      }}
      className={className}
    >
      {copied ? copiedLabel : label}
    </button>
  );
});

export const WrapToggleButton = memo(function WrapToggleButton({
  wrapLines,
  onToggle,
}: {
  wrapLines: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={wrapLines}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide transition-colors ${
        wrapLines
          ? 'border-[var(--color-agent)]/40 bg-[var(--color-agent)]/12 text-[var(--color-agent)]'
          : 'border-[var(--border-weaker-base)] text-[var(--text-weaker)] hover:bg-[var(--background-base)]'
      }`}
    >
      Wrap lines
    </button>
  );
});

export const WrapToggleCodeBlock = memo(function WrapToggleCodeBlock({
  text,
  maxHeightClass,
  preClassName,
  containerClassName,
  copySlot = 'bash-copy',
}: {
  text: string;
  maxHeightClass?: string;
  preClassName?: string;
  containerClassName?: string;
  copySlot?: string;
}): React.ReactElement {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const wrapLines = settings.wrapCodeBlocks;

  const onToggle = async () => {
    const next = !wrapLines;
    // Optimistic update for immediate UI feedback across all code blocks.
    updateSettings({ wrapCodeBlocks: next });
    // Persist using a fresh read of main-process AppSettings to avoid
    // clobbering fields the renderer doesn't hold in SyncedSettings.
    try {
      const current = await window.api.getSettings();
      await window.api.saveSettings({ ...current, wrapCodeBlocks: next });
    } catch {
      // Non-fatal: optimistic state still applied this session.
    }
  };

  return (
    <div
      data-component="wrap-toggle-code-block"
      data-wrap={wrapLines ? 'true' : 'false'}
      className={containerClassName}
    >
      <div className="mb-1 flex items-center justify-end gap-2">
        <WrapToggleButton
          wrapLines={wrapLines}
          onToggle={() => {
            void onToggle();
          }}
        />
      </div>
      <div
        data-component="bash-output"
        className={maxHeightClass}
        data-wrap={wrapLines ? 'true' : 'false'}
      >
        <pre
          data-slot="bash-pre"
          className={preClassName}
          data-wrap={wrapLines ? 'true' : 'false'}
        >
          {text}
        </pre>
        <CopyButton text={text} slot={copySlot} />
      </div>
    </div>
  );
});
