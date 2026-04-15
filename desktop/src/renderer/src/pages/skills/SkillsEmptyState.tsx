export function SkillsEmptyState(): React.ReactElement {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-sm text-[var(--color-text-muted)] mb-2">
          Select a skill or instruction from the sidebar
        </p>
        <p className="text-xs text-[var(--color-text-faint)]">
          Skills and instructions are injected into every agent session
          automatically.
        </p>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Agents can also manage them via the manage_skills_and_instructions
          tool.
        </p>
      </div>
    </div>
  );
}
