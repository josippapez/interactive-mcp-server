import { useState } from 'react';
import type { NativeOpenCodeSkill } from '../../../../preload/api/types';

type Props = {
  skills: NativeOpenCodeSkill[];
};

export function SessionLoadedSkillsPanel({
  skills,
}: Props): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/40 transition-colors cursor-pointer"
        aria-expanded={expanded}
        title="Show skills loaded by OpenCode for this session"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-sm">
            📚
          </span>
          <span className="font-medium">Skills loaded for this session</span>
          <span className="text-[10px] text-[var(--color-text-faint)]">
            {skills.length} skill{skills.length === 1 ? '' : 's'} loaded
          </span>
        </span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          {skills.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-faint)] py-2">
              No OpenCode skills are currently loaded for this session.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {skills.map((skill) => (
                <li key={skill.name} className="py-1 text-xs">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-medium text-[var(--color-text)]">
                      {skill.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-sm border border-[var(--color-border)] text-[var(--color-text-faint)]">
                      loaded
                    </span>
                  </div>
                  {skill.description && (
                    <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                      {skill.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
