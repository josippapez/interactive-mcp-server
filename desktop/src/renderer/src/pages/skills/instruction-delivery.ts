import type {
  InstructionDeliveryMode,
  SkillOrInstruction,
} from './skills-types';

type InstructionDeliveryEntry = Pick<
  SkillOrInstruction,
  'type' | 'injectionMode' | 'alwaysModeWarning'
>;

export function shouldShowInstructionDeliveryControl(
  type: SkillOrInstruction['type'],
): boolean {
  return type === 'instruction';
}

export function getInstructionDeliveryMode(
  entry: Pick<SkillOrInstruction, 'injectionMode'>,
): InstructionDeliveryMode {
  return entry.injectionMode === 'catalog' ? 'catalog' : 'always';
}

export function getAlwaysModeWarning(
  entry: InstructionDeliveryEntry,
): string | null {
  if (!shouldShowInstructionDeliveryControl(entry.type)) {
    return null;
  }

  if (getInstructionDeliveryMode(entry) !== 'always') {
    return null;
  }

  const warning = entry.alwaysModeWarning?.trim();
  return warning ? warning : null;
}
