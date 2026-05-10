import { useMemo } from 'react';
import { SECTIONS, type SettingsSection } from './settings/settings-types';
import { getSectionById } from './settings/section-registry';
import { useSettingsState } from './settings/useSettingsState';

const SETTINGS_GROUPS: { label: string; ids: SettingsSection[] }[] = [
  {
    label: 'General',
    ids: ['server', 'sessions', 'preferences', 'permissions'],
  },
  { label: 'Configuration', ids: ['provider', 'documentation'] },
  { label: 'Advanced', ids: ['agents', 'opencode-config', 'advanced'] },
];

export default function SettingsView(): React.ReactElement {
  const state = useSettingsState();
  const isLoading = !state.settings || !state.initialSettings;

  const activeSectionLabel = isLoading
    ? 'Settings'
    : (getSectionById(state.activeSection)?.label ?? 'Settings');

  const sectionContent = useMemo(() => {
    if (isLoading) return null;
    const entry = getSectionById(state.activeSection);
    if (!entry) return null;
    const SectionComponent = entry.component;
    return <SectionComponent state={state} />;
  }, [isLoading, state]);

  const groupedSections = useMemo(() => {
    const covered = new Set<SettingsSection>();
    const groups = SETTINGS_GROUPS.map((group) => {
      const entries = group.ids
        .map((id) => {
          const found = SECTIONS.find((s) => s.id === id);
          if (found) covered.add(id);
          return found;
        })
        .filter((s): s is (typeof SECTIONS)[number] => s !== undefined);
      return { label: group.label, entries };
    }).filter((g) => g.entries.length > 0);

    const leftover = SECTIONS.filter((s) => !covered.has(s.id));
    if (leftover.length > 0) {
      groups.push({ label: 'Other', entries: leftover });
    }
    return groups;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-faint)] text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <nav className="titlebar-drag w-48 shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-4">
        <h2 className="text-[13px] font-semibold text-[var(--color-text)] mb-3 px-3">
          Settings
        </h2>
        <ul className="space-y-0.5">
          {groupedSections.map((group, groupIndex) => (
            <li key={group.label}>
              <div
                className={`text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] ${
                  groupIndex === 0 ? 'mt-0' : 'mt-4'
                } mb-1 px-3`}
              >
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.entries.map((section) => {
                  const isActive = state.activeSection === section.id;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => state.setActiveSection(section.id)}
                        className={`titlebar-no-drag w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] ${
                          isActive
                            ? 'bg-[var(--color-surface)] text-[var(--color-text)] font-medium'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                        }`}
                      >
                        <section.icon size={13} aria-hidden="true" />
                        <span>{section.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-4">
          <div
            role="separator"
            className="mb-4 h-px w-full bg-[var(--color-border)]"
          />
          <p
            className="text-xs text-[var(--color-text-faint)]"
            aria-live="polite"
          >
            {state.saveState === 'saving'
              ? 'Saving...'
              : state.saveState === 'saved'
                ? 'Saved'
                : state.saveState === 'error'
                  ? 'Save failed'
                  : !state.isFormValid
                    ? 'Invalid values'
                    : state.isDirty
                      ? 'Unsaved changes'
                      : 'All saved'}
          </p>
        </div>
      </nav>

      <main className="titlebar-drag flex-1 overflow-y-auto px-8 py-6">
        <div className="titlebar-no-drag">
          <h3 className="text-[15px] font-semibold text-[var(--color-text)] mb-6 pb-3 border-b border-[var(--color-border-weak)]">
            {activeSectionLabel}
          </h3>
          <div className="max-w-3xl space-y-6">{sectionContent}</div>
        </div>
      </main>
    </div>
  );
}
