import type { SkillOrInstruction } from './skills-types';

type SkillEditorHeaderProps = {
  isCreating: boolean;
  isEditing: boolean;
  selected: SkillOrInstruction | null;
};

export function SkillEditorHeader({
  isCreating,
  isEditing,
  selected,
}: SkillEditorHeaderProps): React.ReactElement {
  return (
    <h3 className="text-base font-medium text-[var(--color-text)]">
      {isCreating
        ? 'New Entry'
        : isEditing
          ? `Edit: ${selected?.name}`
          : selected?.name}
    </h3>
  );
}
