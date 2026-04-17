import { ipcRenderer } from 'electron';
import type { SkillOrInstructionRecord } from './types';

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
  };
}
