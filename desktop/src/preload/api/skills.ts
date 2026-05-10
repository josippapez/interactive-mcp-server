import { ipcRenderer } from 'electron';
import type {
  FolderRecord,
  NativeOpenCodeSkill,
  SkillOrInstructionRecord,
} from './types';

export function createSkillsApi() {
  return {
    // Skills & Instructions CRUD
    upsertSkillOrInstruction: (data: {
      name: string;
      type: 'skill' | 'instruction';
      description: string;
      content: string;
      category?: string | null;
      tags?: string[] | null;
      folderId?: number | null;
      scope?: 'global' | 'session-scoped';
      injectionMode?: 'always' | 'catalog';
    }): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('upsert-skill-or-instruction', data),
    listSkillsAndInstructions: (
      filterType?: 'skill' | 'instruction',
      filterCategory?: string,
    ): Promise<SkillOrInstructionRecord[]> =>
      ipcRenderer.invoke('list-skills-and-instructions', {
        filterType,
        filterCategory,
      }),
    listNativeOpenCodeSkills: (
      baseDirectory?: string,
    ): Promise<NativeOpenCodeSkill[]> =>
      ipcRenderer.invoke('list-native-opencode-skills', baseDirectory),
    getSkillOrInstruction: (
      name: string,
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('get-skill-or-instruction', name),
    deleteSkillOrInstruction: (name: string): Promise<boolean> =>
      ipcRenderer.invoke('delete-skill-or-instruction', name),
    toggleSkillOrInstructionEnabled: (
      name: string,
      enabled: boolean,
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('toggle-skill-or-instruction-enabled', {
        name,
        enabled,
      }),
    duplicateSkillOrInstruction: (
      name: string,
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('duplicate-skill-or-instruction', name),
    resetBuiltinTemplates: (): Promise<{
      resetCount: number;
      templateNames: string[];
    }> => ipcRenderer.invoke('reset-builtin-templates'),
    getMissingBuiltinCount: (): Promise<{
      missingCount: number;
      totalBuiltins: number;
    }> => ipcRenderer.invoke('get-missing-builtin-count'),
    exportSkillsMarkdown: (): Promise<{ saved: boolean; filePath?: string }> =>
      ipcRenderer.invoke('export-skills-markdown'),
    exportSingleSkill: (
      name: string,
    ): Promise<{ saved: boolean; filePath?: string }> =>
      ipcRenderer.invoke('export-single-skill', name),

    // Folders
    listFolders: (): Promise<FolderRecord[]> =>
      ipcRenderer.invoke('list-folders'),
    createFolder: (name: string): Promise<FolderRecord | null> =>
      ipcRenderer.invoke('create-folder', name),
    renameFolder: (id: number, name: string): Promise<FolderRecord | null> =>
      ipcRenderer.invoke('rename-folder', { id, name }),
    deleteFolder: (id: number): Promise<boolean> =>
      ipcRenderer.invoke('delete-folder', id),

    // Entry folder/scope setters
    setEntryFolder: (
      name: string,
      folderId: number | null,
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('set-entry-folder', { name, folderId }),
    setEntryScope: (
      name: string,
      scope: 'global' | 'session-scoped',
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('set-entry-scope', { name, scope }),
    setEntryInjectionMode: (
      name: string,
      injectionMode: 'always' | 'catalog',
    ): Promise<SkillOrInstructionRecord | null> =>
      ipcRenderer.invoke('set-entry-injection-mode', { name, injectionMode }),

    // Session-scoped opt-ins
    listSessionScopedEntries: (
      providerType: string,
      providerSessionId: string,
    ): Promise<string[]> =>
      ipcRenderer.invoke('list-session-scoped-entries', {
        providerType,
        providerSessionId,
      }),
    setSessionScopedEntries: (
      providerType: string,
      providerSessionId: string,
      entryNames: string[],
    ): Promise<boolean> =>
      ipcRenderer.invoke('set-session-scoped-entries', {
        providerType,
        providerSessionId,
        entryNames,
      }),

    // Session-muted entries (per-session mute list for global entries)
    listSessionMutedEntries: (
      providerType: string,
      providerSessionId: string,
    ): Promise<string[]> =>
      ipcRenderer.invoke('list-session-muted-entries', {
        providerType,
        providerSessionId,
      }),
    setSessionMutedEntries: (
      providerType: string,
      providerSessionId: string,
      entryNames: string[],
    ): Promise<boolean> =>
      ipcRenderer.invoke('set-session-muted-entries', {
        providerType,
        providerSessionId,
        entryNames,
      }),
  };
}
