/**
 * Main-side proxy client for DB functions that now live in the utility process.
 *
 * Every exported function mirrors the original `database.ts` API but returns a
 * `Promise<T>` and dispatches the call across the utility-process bridge via
 * `bridge.request('db.<name>', { args: [...] })`.
 *
 * DB-owner-local callers (modules that themselves live in the utility process,
 * e.g. `session/auto-register.ts` and `session/resolver.ts` after Checkpoint B)
 * MUST NOT import this file. They import `./backend/database` directly.
 *
 * Type-only re-exports (`RegisteredConnection`, `SkillOrInstruction`, ...)
 * continue to be sourced from the moved DB module — TypeScript pulls the
 * declarations without runtime dependency, and the file resides in the main
 * bundle's reachable graph via this client.
 */
import type { Bridge } from './bridge';
import { getUtilitySupervisor } from './supervisor';
import type {
  RegisteredConnection,
  SkillOrInstruction,
  SkillScope,
  InstructionDeliveryMode,
  ConversationRecord,
  SessionChannelMessageRecord,
  ContextInjection,
  PinnedProject,
  Folder,
} from './backend/database';

export type {
  RegisteredConnection,
  SkillOrInstruction,
  SkillScope,
  InstructionDeliveryMode,
  ConversationRecord,
  SessionChannelMessageRecord,
  ContextInjection,
  PinnedProject,
  Folder,
};

function bridge(): Bridge {
  return getUtilitySupervisor().getBridge();
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return bridge().request<T>(`db.${name}`, { args });
}

// ─── Conversations ─────────────────────────────────────────────────────────
export function saveConversation(data: {
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions?: string[];
  attachments?: {
    data: string;
    mimeType: string;
    name: string;
    size: number;
  }[];
}): Promise<void> {
  return call('saveConversation', [data]);
}

export function getConversationHistory(
  limit = 100,
): Promise<ConversationRecord[]> {
  return call('getConversationHistory', [limit]);
}

export function clearHistory(): Promise<void> {
  return call('clearHistory', []);
}

// ─── Database reset ────────────────────────────────────────────────────────
export function resetDatabase(): Promise<{
  ok: boolean;
  clearedTables: string[];
  removedIdFiles: number;
}> {
  return call('resetDatabase', []);
}

// ─── Session channels ──────────────────────────────────────────────────────
export function createSessionChannel(
  sessionId: string,
  label?: string,
): Promise<void> {
  return call('createSessionChannel', [sessionId, label]);
}

export function getUnsentMessages(
  sessionId: string,
): Promise<{ id: number; message: string; createdAt: string }[]> {
  return call('getUnsentMessages', [sessionId]);
}

export function getUnsentCount(sessionId: string): Promise<number> {
  return call('getUnsentCount', [sessionId]);
}

export function markMessagesSent(ids: number[]): Promise<void> {
  return call('markMessagesSent', [ids]);
}

export function queueSessionMessage(
  sessionId: string,
  message: string,
): Promise<void> {
  return call('queueSessionMessage', [sessionId, message]);
}

export function appendSessionChannelMessage(data: {
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments?: {
    data: string;
    mimeType: string;
    name: string;
    size: number;
  }[];
}): Promise<void> {
  return call('appendSessionChannelMessage', [data]);
}

export function getSessionChannelHistory(
  sessionId: string,
  limit = 500,
): Promise<SessionChannelMessageRecord[]> {
  return call('getSessionChannelHistory', [sessionId, limit]);
}

export function clearSessionChannelMessages(sessionId: string): Promise<void> {
  return call('clearSessionChannelMessages', [sessionId]);
}

export function deleteSessionChannel(sessionId: string): Promise<void> {
  return call('deleteSessionChannel', [sessionId]);
}

export function getActiveSessionChannels(): Promise<
  {
    sessionId: string;
    label: string | null;
    createdAt: string;
    providerSessionId: string | null;
    parentSessionId: string | null;
  }[]
> {
  return call('getActiveSessionChannels', []);
}

// ─── Registered connections ────────────────────────────────────────────────
export function agentIdFilePath(
  channelName: string,
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'standalone',
): Promise<string> {
  return call('agentIdFilePath', [
    channelName,
    providerSessionId,
    providerType,
  ]);
}

export function upsertRegisteredConnection(data: {
  providerSessionId: string;
  channelName: string;
  projectName: string;
  connectionId?: string | null;
  baseDirectory?: string;
  parentSessionId?: string | null;
  providerType?: RegisteredConnection['providerType'];
}): Promise<string> {
  return call('upsertRegisteredConnection', [data]);
}

export function getAllRegisteredConnections(): Promise<RegisteredConnection[]> {
  return call('getAllRegisteredConnections', []);
}

export function getRegisteredConnection(
  connectionId: string,
): Promise<RegisteredConnection | null> {
  return call('getRegisteredConnection', [connectionId]);
}

export function getRegisteredConnectionsByConnectionId(
  connectionId: string,
): Promise<RegisteredConnection[]> {
  return call('getRegisteredConnectionsByConnectionId', [connectionId]);
}

export function getRegisteredConnectionBySessionId(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): Promise<RegisteredConnection | null> {
  return call('getRegisteredConnectionBySessionId', [
    providerSessionId,
    providerType,
  ]);
}

export function updateConnectionId(
  providerSessionId: string,
  connectionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): Promise<void> {
  return call('updateConnectionId', [
    providerSessionId,
    connectionId,
    providerType,
  ]);
}

export function isProviderSessionClaimed(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): Promise<boolean> {
  return call('isProviderSessionClaimed', [providerSessionId, providerType]);
}

export function getRegisteredConnectionsByProvider(
  providerType: RegisteredConnection['providerType'],
): Promise<RegisteredConnection[]> {
  return call('getRegisteredConnectionsByProvider', [providerType]);
}

export function deleteRegisteredConnection(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): Promise<void> {
  return call('deleteRegisteredConnection', [providerSessionId, providerType]);
}

// ─── Skills & Instructions ─────────────────────────────────────────────────
export function upsertSkillOrInstruction(data: {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
  folderId?: number | null;
  scope?: SkillScope;
  deliveryMode?: InstructionDeliveryMode;
}): Promise<SkillOrInstruction | null> {
  return call('upsertSkillOrInstruction', [data]);
}

export function listSkillsAndInstructions(
  filterType?: 'skill' | 'instruction',
  filterCategory?: string,
): Promise<SkillOrInstruction[]> {
  return call('listSkillsAndInstructions', [filterType, filterCategory]);
}

export function getSkillOrInstructionByName(
  name: string,
): Promise<SkillOrInstruction | null> {
  return call('getSkillOrInstructionByName', [name]);
}

export function deleteSkillOrInstruction(name: string): Promise<boolean> {
  return call('deleteSkillOrInstruction', [name]);
}

export function toggleSkillOrInstructionEnabled(
  name: string,
  enabled: boolean,
): Promise<SkillOrInstruction | null> {
  return call('toggleSkillOrInstructionEnabled', [name, enabled]);
}

export function setEntryInjectionMode(
  entryName: string,
  deliveryMode: InstructionDeliveryMode,
): Promise<SkillOrInstruction | null> {
  return call('setEntryInjectionMode', [entryName, deliveryMode]);
}

export function duplicateSkillOrInstruction(
  name: string,
): Promise<SkillOrInstruction | null> {
  return call('duplicateSkillOrInstruction', [name]);
}

export function seedBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): Promise<number> {
  return call('seedBuiltinTemplates', [templates]);
}

export function resetBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): Promise<number> {
  return call('resetBuiltinTemplates', [templates]);
}

export function getMissingBuiltinCount(
  templateNames: string[],
): Promise<number> {
  return call('getMissingBuiltinCount', [templateNames]);
}

// ─── Context injections ────────────────────────────────────────────────────
export function upsertContextInjection(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
  payload: string,
  source = 'manual',
  replaceKey?: string,
): Promise<void> {
  return call('upsertContextInjection', [
    providerSessionId,
    providerType,
    payload,
    source,
    replaceKey,
  ]);
}

export function claimContextInjections(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): Promise<ContextInjection[]> {
  return call('claimContextInjections', [providerSessionId, providerType]);
}

export function deleteContextInjectionsForSession(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): Promise<void> {
  return call('deleteContextInjectionsForSession', [
    providerSessionId,
    providerType,
  ]);
}

// ─── Pinned projects ───────────────────────────────────────────────────────
export function getPinnedProjects(): Promise<PinnedProject[]> {
  return call('getPinnedProjects', []);
}

export function addPinnedProject(path: string, name: string): Promise<boolean> {
  return call('addPinnedProject', [path, name]);
}

export function removePinnedProject(path: string): Promise<boolean> {
  return call('removePinnedProject', [path]);
}

// ─── Folders ───────────────────────────────────────────────────────────────
export function listFolders(): Promise<Folder[]> {
  return call('listFolders', []);
}

export function createFolder(name: string): Promise<Folder | null> {
  return call('createFolder', [name]);
}

export function renameFolder(
  id: number,
  newName: string,
): Promise<Folder | null> {
  return call('renameFolder', [id, newName]);
}

export function deleteFolder(id: number): Promise<boolean> {
  return call('deleteFolder', [id]);
}

export function setEntryFolder(
  entryName: string,
  folderId: number | null,
): Promise<boolean> {
  return call('setEntryFolder', [entryName, folderId]);
}

export function setEntryScope(
  entryName: string,
  scope: SkillScope,
): Promise<boolean> {
  return call('setEntryScope', [entryName, scope]);
}

// ─── Session-scoped / muted entry lists ────────────────────────────────────
export function listSessionScopedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): Promise<string[]> {
  return call('listSessionScopedEntryNames', [providerType, providerSessionId]);
}

export function setSessionScopedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): Promise<void> {
  return call('setSessionScopedEntries', [
    providerType,
    providerSessionId,
    entryNames,
  ]);
}

export function listSessionMutedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): Promise<string[]> {
  return call('listSessionMutedEntryNames', [providerType, providerSessionId]);
}

export function setSessionMutedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): Promise<void> {
  return call('setSessionMutedEntries', [
    providerType,
    providerSessionId,
    entryNames,
  ]);
}

// ─── Init (main-side no-op pre-utility, delegated otherwise) ───────────────
/**
 * Kept as an importable symbol for backwards compatibility with the call site
 * in `main/index.ts`. The actual `initDatabase` runs inside the utility process
 * on init-message receipt — main does not need to call this. Exported as a
 * resolved no-op so existing code that does `await initDatabase()` still works
 * during the transition.
 */
export async function initDatabase(): Promise<void> {
  // No-op on main — DB lives in the utility process. See utility/entry.ts.
}
