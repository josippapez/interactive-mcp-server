import {
  getAllRegisteredConnections,
  type RegisteredConnection,
} from '../database';
import type { AppSettings } from '../settings';
import { createLogger } from '../utils/logger';
import { replyToOpenCodePermission } from './permission-reply';

const sseLog = createLogger('sse');

export type PromptReply = 'once' | 'always' | 'reject';

export type BusEventHandlerDependencies = {
  getOpenCodePort?: (() => number) | null;
  getSettings?: (() => AppSettings) | null;
};

export function getRegisteredConnectionForSession(
  sessionID: string,
): RegisteredConnection | null {
  const connections = getAllRegisteredConnections();
  return connections.find((c) => c.openCodeSessionId === sessionID) ?? null;
}

export function getStringProperty(
  properties: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

export function getStringArrayProperty(
  properties: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = properties[key];
  if (!Array.isArray(value)) return undefined;

  const items = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return items.length > 0 ? items : undefined;
}

export function getQuestionOptions(
  properties: Record<string, unknown>,
): string[] | undefined {
  const predefinedOptions = getStringArrayProperty(
    properties,
    'predefinedOptions',
  );
  if (predefinedOptions) {
    return predefinedOptions;
  }

  const options = properties['options'];
  if (!Array.isArray(options)) return undefined;

  const labels = options
    .map((option) => {
      if (typeof option === 'string') return option;
      if (!option || typeof option !== 'object') return null;

      const label = (option as Record<string, unknown>)['label'];
      const value = (option as Record<string, unknown>)['value'];
      if (typeof label === 'string' && label.length > 0) return label;
      if (typeof value === 'string' && value.length > 0) return value;
      return null;
    })
    .filter((item): item is string => typeof item === 'string');

  return labels.length > 0 ? labels : undefined;
}

export function isFileReadPermission(permission: string): boolean {
  const lower = permission.toLowerCase();
  return (
    lower.includes('read') ||
    lower.includes('file_read') ||
    lower.startsWith('read ')
  );
}

export function shouldAutoApproveReadPermission(
  patterns: string[] | undefined,
  allowedFolders: string[],
): boolean {
  if (!patterns || patterns.length === 0 || allowedFolders.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    if (!pattern.startsWith('/')) continue;

    for (const folder of allowedFolders) {
      const normalizedFolder = folder.endsWith('/') ? folder : `${folder}/`;
      if (pattern.startsWith(normalizedFolder) || pattern === folder) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Auto-reply to a permission request using SDK.
 */
export async function autoReplyPermission(
  sessionID: string,
  requestId: string,
  reply: PromptReply,
  getOpenCodePort?: (() => number) | null,
): Promise<void> {
  const port = getOpenCodePort?.() ?? 4096;

  try {
    const result = await replyToOpenCodePermission(
      port,
      sessionID,
      requestId,
      reply,
    );

    if (result.ok) {
      sseLog.info(
        `Auto-approved read permission ${requestId} with reply: ${reply}`,
      );
    }
  } catch {
    // Silently fail - permission auto-approve is best-effort
  }
}
