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
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setEntryFolder,
  setEntryScope,
  setEntryInjectionMode,
  listSessionScopedEntryNames,
  setSessionScopedEntries,
  listSessionMutedEntryNames,
  setSessionMutedEntries,
  type InstructionDeliveryMode,
  type RegisteredConnection,
  type SkillScope,
} from '../../utility/db-client';
import {
  BUILTIN_TEMPLATES,
  getBuiltinTemplateNames,
} from '../../builtin-templates';
import {
  broadcastSkillsChanged,
  broadcastSessionScopeChanged,
} from '../../utility/backend/tools/skills-broadcast';
import { IpcHandlerDeps } from './types';

export function registerSkillsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'upsert-skill-or-instruction',
    async (
      _event,
      data: {
        name: string;
        type: 'skill' | 'instruction';
        description: string;
        content: string;
        category?: string | null;
        tags?: string[] | null;
        folderId?: number | null;
        scope?: SkillScope;
        injectionMode?: InstructionDeliveryMode;
      },
    ) => {
      const existing = await getSkillOrInstructionByName(data.name);
      const result = await upsertSkillOrInstruction(data);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
        broadcastSkillsChanged(
          existing ? 'updated' : 'registered',
          data.type,
          data.name,
          deps.getSettings().openCodePort,
          result.type === 'instruction' ? result.deliveryMode : undefined,
        );
      }
      return result;
    },
  );

  ipcMain.handle(
    'list-skills-and-instructions',
    async (
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

  ipcMain.handle('get-skill-or-instruction', async (_event, name: string) => {
    return getSkillOrInstructionByName(name);
  });

  ipcMain.handle(
    'delete-skill-or-instruction',
    async (_event, name: string) => {
      const existing = await getSkillOrInstructionByName(name);
      const deleted = await deleteSkillOrInstruction(name);
      if (deleted) {
        deps.getMainWindow()?.webContents.send('skills-updated');
        if (existing) {
          broadcastSkillsChanged(
            'deleted',
            existing.type,
            existing.name,
            deps.getSettings().openCodePort,
            existing.type === 'instruction' ? existing.deliveryMode : undefined,
          );
        }
      }
      return deleted;
    },
  );

  ipcMain.handle(
    'toggle-skill-or-instruction-enabled',
    async (_event, data: { name: string; enabled: boolean }) => {
      const result = await toggleSkillOrInstructionEnabled(
        data.name,
        data.enabled,
      );
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
        broadcastSkillsChanged(
          'updated',
          result.type,
          result.name,
          deps.getSettings().openCodePort,
          result.type === 'instruction' ? result.deliveryMode : undefined,
        );
      }
      return result;
    },
  );

  ipcMain.handle(
    'duplicate-skill-or-instruction',
    async (_event, name: string) => {
      const result = await duplicateSkillOrInstruction(name);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle(
    'reset-builtin-templates',
    async (): Promise<{ resetCount: number; templateNames: string[] }> => {
      const resetCount = await resetBuiltinTemplates(BUILTIN_TEMPLATES);
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
    async (): Promise<{ missingCount: number; totalBuiltins: number }> => {
      const templateNames = getBuiltinTemplateNames();
      const missingCount = await getMissingBuiltinCount(templateNames);
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

      const entries = await listSkillsAndInstructions();
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

      const entry = await getSkillOrInstructionByName(name);
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

  // ─── Folders ──────────────────────────────────────────────────────────────

  ipcMain.handle('list-folders', async () => {
    return listFolders();
  });

  ipcMain.handle('create-folder', async (_event, name: string) => {
    const folder = await createFolder(name);
    if (folder) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return folder;
  });

  ipcMain.handle(
    'rename-folder',
    async (_event, data: { id: number; name: string }) => {
      const folder = await renameFolder(data.id, data.name);
      if (folder) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return folder;
    },
  );

  ipcMain.handle('delete-folder', async (_event, id: number) => {
    const deleted = await deleteFolder(id);
    if (deleted) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return deleted;
  });

  // ─── Entry folder/scope setters ───────────────────────────────────────────

  ipcMain.handle(
    'set-entry-folder',
    async (_event, data: { name: string; folderId: number | null }) => {
      const result = await setEntryFolder(data.name, data.folderId);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle(
    'set-entry-scope',
    async (_event, data: { name: string; scope: SkillScope }) => {
      const result = await setEntryScope(data.name, data.scope);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
        const entry = await getSkillOrInstructionByName(data.name);
        if (entry) {
          broadcastSkillsChanged(
            'updated',
            entry.type,
            entry.name,
            deps.getSettings().openCodePort,
            entry.type === 'instruction' ? entry.deliveryMode : undefined,
          );
        }
      }
      return result;
    },
  );

  ipcMain.handle(
    'set-entry-injection-mode',
    async (
      _event,
      data: { name: string; injectionMode: InstructionDeliveryMode },
    ) => {
      const result = await setEntryInjectionMode(data.name, data.injectionMode);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
        broadcastSkillsChanged(
          'updated',
          result.type,
          result.name,
          deps.getSettings().openCodePort,
          result.deliveryMode,
        );
      }
      return result;
    },
  );

  // ─── Session-scoped opt-ins ───────────────────────────────────────────────

  ipcMain.handle(
    'list-session-scoped-entries',
    async (
      _event,
      data: { providerType: string; providerSessionId: string },
    ): Promise<string[]> => {
      return listSessionScopedEntryNames(
        data.providerType as RegisteredConnection['providerType'],
        data.providerSessionId,
      );
    },
  );

  ipcMain.handle(
    'set-session-scoped-entries',
    async (
      _event,
      data: {
        providerType: string;
        providerSessionId: string;
        entryNames: string[];
      },
    ): Promise<boolean> => {
      const providerType =
        data.providerType as RegisteredConnection['providerType'];
      const prev = new Set(
        await listSessionScopedEntryNames(providerType, data.providerSessionId),
      );
      const next = new Set(data.entryNames);
      await setSessionScopedEntries(
        providerType,
        data.providerSessionId,
        data.entryNames,
      );

      // Compute diff for the reminder broadcast
      const addedNames = [...next].filter((n) => !prev.has(n));
      const removedNames = [...prev].filter((n) => !next.has(n));
      if (addedNames.length > 0 || removedNames.length > 0) {
        const addedEntries = await Promise.all(
          addedNames.map((name) => getSkillOrInstructionByName(name as string)),
        );
        const added = addedEntries
          .filter((e): e is NonNullable<typeof e> => e != null)
          .map((e) => ({ name: e.name, type: e.type }));
        const removedEntries = await Promise.all(
          removedNames.map((name) =>
            getSkillOrInstructionByName(name as string),
          ),
        );
        const removed = removedEntries
          .filter((e): e is NonNullable<typeof e> => e != null)
          .map((e) => ({ name: e.name, type: e.type }));
        broadcastSessionScopeChanged(
          providerType,
          data.providerSessionId,
          { added, removed },
          deps.getSettings().openCodePort,
        );
      }
      return true;
    },
  );

  // ─── Session-muted entries (per-session mute list for global entries) ────

  ipcMain.handle(
    'list-session-muted-entries',
    async (
      _event,
      data: { providerType: string; providerSessionId: string },
    ): Promise<string[]> => {
      return listSessionMutedEntryNames(
        data.providerType as RegisteredConnection['providerType'],
        data.providerSessionId,
      );
    },
  );

  ipcMain.handle(
    'set-session-muted-entries',
    async (
      _event,
      data: {
        providerType: string;
        providerSessionId: string;
        entryNames: string[];
      },
    ): Promise<boolean> => {
      const providerType =
        data.providerType as RegisteredConnection['providerType'];
      await setSessionMutedEntries(
        providerType,
        data.providerSessionId,
        data.entryNames,
      );
      return true;
    },
  );
}
