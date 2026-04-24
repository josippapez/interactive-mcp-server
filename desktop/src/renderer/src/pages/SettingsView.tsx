import { useMemo } from 'react';
import { SECTIONS } from './settings/settings-types';
import { getSectionById } from './settings/section-registry';
import { useSettingsState } from './settings/useSettingsState';

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-faint)] text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
        <h2 className="text-base font-medium text-[var(--color-text)] mb-4">
          Settings
        </h2>
        <ul className="space-y-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => state.setActiveSection(section.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm transition-colors text-left ${
                  state.activeSection === section.id
                    ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                }`}
              >
                <section.icon size={14} aria-hidden="true" />
                <span>{section.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
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

      <main className="flex-1 overflow-y-auto p-6">
        <h3 className="text-20-medium text-[var(--color-text)] mb-4 pb-2 border-b border-[var(--color-border-weak)]">
          {activeSectionLabel}
        </h3>
        <div className="max-w-2xl">{sectionContent}</div>
      </main>
    </div>
  );
}
