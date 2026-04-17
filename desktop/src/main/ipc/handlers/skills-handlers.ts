import { dialog, ipcMain } from 'electron';
import { writeFileSync } from 'fs';
import JSZip from 'jszip';
import {
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
  toggleSkillOrInstructionEnabled,
  duplicateSkillOrInstruction,
  resetBuiltinTemplates,
  getMissingBuiltinCount,
} from '../../database';
import {
  BUILTIN_TEMPLATES,
  getBuiltinTemplateNames,
} from '../../builtin-templates';
import { IpcHandlerDeps } from './types';

export function registerSkillsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'upsert-skill-or-instruction',
    (
      _event,
      data: {
        name: string;
        type: 'skill' | 'instruction';
        description: string;
        content: string;
        category?: string | null;
        tags?: string[] | null;
      },
    ) => {
      const result = upsertSkillOrInstruction(data);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle(
    'list-skills-and-instructions',
    (
      _event,
      params?: {
        filterType?: 'skill' | 'instruction';
        filterCategory?: string;
      },
    ) => {
      return listSkillsAndInstructions(
        params?.filterType,
        params?.filterCategory,
      );
    },
  );

  ipcMain.handle('get-skill-or-instruction', (_event, name: string) => {
    return getSkillOrInstructionByName(name);
  });

  ipcMain.handle('delete-skill-or-instruction', (_event, name: string) => {
    const deleted = deleteSkillOrInstruction(name);
    if (deleted) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return deleted;
  });

  ipcMain.handle(
    'toggle-skill-or-instruction-enabled',
    (_event, data: { name: string; enabled: boolean }) => {
      const result = toggleSkillOrInstructionEnabled(data.name, data.enabled);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle('duplicate-skill-or-instruction', (_event, name: string) => {
    const result = duplicateSkillOrInstruction(name);
    if (result) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return result;
  });

  ipcMain.handle(
    'reset-builtin-templates',
    (): { resetCount: number; templateNames: string[] } => {
      const resetCount = resetBuiltinTemplates(BUILTIN_TEMPLATES);
      if (resetCount > 0) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return {
        resetCount,
        templateNames: getBuiltinTemplateNames(),
      };
    },
  );

  ipcMain.handle(
    'get-missing-builtin-count',
    (): { missingCount: number; totalBuiltins: number } => {
      const templateNames = getBuiltinTemplateNames();
      const missingCount = getMissingBuiltinCount(templateNames);
      return {
        missingCount,
        totalBuiltins: templateNames.length,
      };
    },
  );

  ipcMain.handle(
    'export-skills-markdown',
    async (): Promise<{ saved: boolean; filePath?: string }> => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };

      const result = await dialog.showSaveDialog(win, {
        title: 'Export Skills & Instructions',
        defaultPath: 'skills-and-instructions.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      const entries = listSkillsAndInstructions();
      const skills = entries.filter((e) => e.type === 'skill');
      const instructions = entries.filter((e) => e.type === 'instruction');

      const zip = new JSZip();
      const skillsFolder = zip.folder('skills');
      for (const entry of skills) {
        skillsFolder?.file(`${entry.name}.md`, entry.content);
      }
      const instructionsFolder = zip.folder('instructions');
      for (const entry of instructions) {
        instructionsFolder?.file(`${entry.name}.md`, entry.content);
      }

      const readmeLines = [
        '# Skills & Instructions',
        '',
        `Exported on ${new Date().toISOString()}`,
        '',
      ];
      if (skills.length > 0) {
        readmeLines.push('## Skills', '');
        for (const e of skills) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push('');
      }
      if (instructions.length > 0) {
        readmeLines.push('## Instructions', '');
        for (const e of instructions) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push('');
      }
      zip.file('README.md', readmeLines.join('\n'));

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      writeFileSync(result.filePath, buffer);
      return { saved: true, filePath: result.filePath };
    },
  );

  ipcMain.handle(
    'export-single-skill',
    async (
      _event,
      name: string,
    ): Promise<{ saved: boolean; filePath?: string }> => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };

      const entry = getSkillOrInstructionByName(name);
      if (!entry) return { saved: false };

      const result = await dialog.showSaveDialog(win, {
        title: `Export ${entry.name}`,
        defaultPath: `${entry.name}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      writeFileSync(result.filePath, entry.content, 'utf-8');
      return { saved: true, filePath: result.filePath };
    },
  );
}
