export type SkillScope = 'global' | 'session-scoped';

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
  folderId: number | null;
  scope: SkillScope;
};

export type Folder = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type TabType = 'all' | 'skill' | 'instruction';

/**
 * Sentinel for the sidebar folder filter.
 * `null` = show all folders. A number = filter to that folder.
 * `'unfiled'` = show entries with folderId === null.
 */
export type FolderFilter = number | 'unfiled' | null;

export const PREDEFINED_CATEGORIES = [
  'Code Review',
  'Testing',
  'Documentation',
  'Workflow',
  'Style Guide',
  'Other',
];
