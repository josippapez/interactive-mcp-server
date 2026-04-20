import { useEffect, useMemo, useState } from 'react';
import type { SkillOrInstructionRecord } from '../../../../preload/api/types';
import {
  isEntryActiveForSession,
  useLoadSessionSkills,
  useSessionSkillsSelection,
  useToggleSessionMute,
  useToggleSessionOptIn,
  useInvalidateSessionSkills,
} from '../../store/session-skills';

type Props = {
  providerType: string | null;
  providerSessionId: string | null;
};

/**
 * Inline panel shown just above the composer. Lists every enabled
 * skill/instruction in the DB with a single "Active for this session"
 * checkbox per entry.
 *
 * Active state is computed from the entry's scope and the session's
 * opt-in / mute sets (see `isEntryActiveForSession`):
 *   - `global` entries default ACTIVE; unchecking adds to the session mute list.
 *   - `session-scoped` entries default INACTIVE; checking adds to the session
 *     opt-in list.
 *
 * Scope changes (global ⇄ session-scoped) are intentionally NOT available
 * here — use the Skills tab's detail view for that. This panel is for
 * per-session injection control only.
 */
export function SessionScopedSkillsPanel({
  providerType,
  providerSessionId,
}: Props): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<SkillOrInstructionRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const canLoad = Boolean(providerType && providerSessionId);
  const selection = useSessionSkillsSelection(providerType, providerSessionId);
  const loadSelection = useLoadSessionSkills();
  const toggleOptIn = useToggleSessionOptIn();
  const toggleMute = useToggleSessionMute();
  const invalidate = useInvalidateSessionSkills();

  // Load entries from DB + selection when session changes.
  useEffect(() => {
    if (!canLoad || !providerType || !providerSessionId) return;
    let cancelled = false;
    void (async () => {
      const all = await window.api.listSkillsAndInstructions();
      if (cancelled) return;
      setEntries(all.filter((e) => e.enabled !== false));
      await loadSelection(providerType, providerSessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, [canLoad, providerType, providerSessionId, loadSelection]);

  // Refresh on skills-changed events from anywhere in the app.
  useEffect(() => {
    const dispose = window.api.onSkillsUpdated(() => {
      if (!canLoad || !providerType || !providerSessionId) return;
      void (async () => {
        const all = await window.api.listSkillsAndInstructions();
        setEntries(all.filter((e) => e.enabled !== false));
        invalidate();
        await loadSelection(providerType, providerSessionId);
      })();
    });
    return dispose;
  }, [canLoad, providerType, providerSessionId, invalidate, loadSelection]);

  const activeCount = useMemo(
    () => entries.filter((e) => isEntryActiveForSession(e, selection)).length,
    [entries, selection],
  );

  if (!canLoad) return null;

  const onToggle = async (entry: SkillOrInstructionRecord): Promise<void> => {
    if (!providerType || !providerSessionId) return;
    setSaveStatus('Saving…');
    try {
      if (entry.scope === 'global') {
        await toggleMute(providerType, providerSessionId, entry.name);
      } else {
        await toggleOptIn(providerType, providerSessionId, entry.name);
      }
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 1200);
    } catch (err) {
      setSaveStatus(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/40 transition-colors cursor-pointer"
        aria-expanded={expanded}
        title="Toggle which skills & instructions are injected into this session"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-sm">
            📚
          </span>
          <span className="font-medium">Skills for this session</span>
          <span className="text-[10px] text-[var(--color-text-faint)]">
            {entries.length === 0
              ? 'none available'
              : `${activeCount}/${entries.length} active`}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-[10px] text-[var(--color-text-faint)]">
              {saveStatus}
            </span>
          )}
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          {entries.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-faint)] py-2">
              No skills or instructions yet. Open the Skills tab to create one.
            </p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {entries.map((e) => (
                <SessionSkillRow
                  key={e.name}
                  entry={e}
                  active={isEntryActiveForSession(e, selection)}
                  onToggle={() => void onToggle(e)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row subcomponent ──────────────────────────────────────────────────────

type RowProps = {
  entry: SkillOrInstructionRecord;
  active: boolean;
  onToggle: () => void;
};

function SessionSkillRow({
  entry,
  active,
  onToggle,
}: RowProps): React.ReactElement {
  const id = `session-skill-${entry.name}`;
  const scopeLabel = entry.scope === 'global' ? 'global' : 'session';
  return (
    <li className="flex items-start gap-2 text-xs py-1">
      <input
        type="checkbox"
        id={id}
        checked={active}
        onChange={onToggle}
        className="mt-0.5 cursor-pointer"
        aria-label={`${active ? 'Deactivate' : 'Activate'} ${entry.name} for this session`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <label
            htmlFor={id}
            className="font-medium text-[var(--color-text)] cursor-pointer truncate"
          >
            {entry.name}
          </label>
          <span className="text-[9px] text-[var(--color-text-faint)] uppercase tracking-wide">
            {entry.type}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded-sm border ${
              entry.scope === 'session-scoped'
                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-faint)]'
            }`}
            title={
              entry.scope === 'session-scoped'
                ? 'Session-scoped: only injected when opted in per-session'
                : 'Global: injected into all sessions unless muted'
            }
          >
            {scopeLabel}
          </span>
        </div>
        {entry.description && (
          <span className="block text-[var(--color-text-muted)] text-[10px] truncate">
            {entry.description}
          </span>
        )}
      </div>
    </li>
  );
}
