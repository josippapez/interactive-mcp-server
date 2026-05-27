import { ipcMain } from 'electron';
import { listSkillsAndInstructions } from '../../utility/db-client';
import {
  buildSkillSuggestionText,
  matchSkillsForMessage,
} from '../../utility/backend/tools/skill-match';
import { createLogger } from '../../utils/logger';
import {
  writeSessionLog,
  type SessionLogLevel,
} from '../../utils/session-logger';
import type { IpcHandlerDeps } from './types';

const ipcLog = createLogger('ipc');
const rendererLog = createLogger('renderer');

export function registerRendererLogChannel(deps: IpcHandlerDeps): void {
  ipcMain.on(
    'renderer-log',
    (
      _event,
      data: {
        level: 'debug' | 'info' | 'warn' | 'error';
        category: string;
        message: string;
        sessionId?: string | null;
      },
    ) => {
      const logFn = rendererLog[data.level] ?? rendererLog.info;
      logFn(`[${data.category}] ${data.message}`);
      writeSessionLog(
        deps.getLogsDir(),
        data.sessionId,
        data.level.toUpperCase() as SessionLogLevel,
        `renderer:${data.category}`,
        data.message,
      );
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

export function getEffectiveOpenCodePort(deps: IpcHandlerDeps): number {
  const resolvedPort = deps.getResolvedPorts().openCode;
  return resolvedPort ?? deps.getSettings().openCodePort;
}

export function getEffectiveMcpPort(deps: IpcHandlerDeps): number {
  const resolvedPort = deps.getResolvedPorts().mcp;
  return resolvedPort ?? deps.getSettings().port;
}
