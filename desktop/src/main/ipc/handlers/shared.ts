import { ipcMain } from 'electron';
import { listSkillsAndInstructions } from '../../utility/db-client';
import {
  buildSkillSuggestionText,
  matchSkillsForMessage,
} from '../../utility/backend/tools/skill-match';
import { createLogger } from '../../utils/logger';

const ipcLog = createLogger('ipc');
const rendererLog = createLogger('renderer');

export function registerRendererLogChannel(): void {
  ipcMain.on(
    'renderer-log',
    (
      _event,
      data: {
        level: 'debug' | 'info' | 'warn' | 'error';
        category: string;
        message: string;
      },
    ) => {
      const logFn = rendererLog[data.level] ?? rendererLog.info;
      logFn(`[${data.category}] ${data.message}`);
    },
  );
}

export async function withSkillSuggestion(message: string): Promise<string> {
  const skills = await listSkillsAndInstructions('skill');
  const matched = matchSkillsForMessage(message, skills);
  const suggestion = buildSkillSuggestionText(matched);
  if (!suggestion) {
    return message;
  }

  return `${suggestion}\n\n${message}`;
}

export function logIpcInfo(message: string): void {
  ipcLog.info(message);
}
