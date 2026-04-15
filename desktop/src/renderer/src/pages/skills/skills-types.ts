export type SkillOrInstruction = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  enabled: boolean;
  isBuiltin: boolean;
  category: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export type TabType = 'all' | 'skill' | 'instruction';

export const PREDEFINED_CATEGORIES = [
  'Code Review',
  'Testing',
  'Documentation',
  'Workflow',
  'Style Guide',
  'Other',
];
