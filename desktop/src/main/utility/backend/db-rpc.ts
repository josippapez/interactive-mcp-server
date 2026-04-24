/**
 * RPC bridge handlers for DB functions callable from the main process.
 *
 * Phase 3 design note — don't overengineer:
 *   - One RPC name per DB function, named after the function:
 *       bridge.handle('db.<functionName>', args => dbModule.<functionName>(...args))
 *   - Args are forwarded positionally (payload is `{ args: unknown[] }`).
 *   - Return value flows back over the bridge as JSON (better-sqlite3 returns
 *     plain objects / primitives — already structured-cloneable).
 *
 * Only functions that have a main-side caller (per the Phase 3 inventory) are
 * registered here. If main later needs another DB function, add it to both
 * `db-client.ts` (main-side proxy) AND this file (utility-side handler).
 *
 * Modules that live fully inside the utility process (e.g. `auto-register.ts`,
 * `resolver.ts` after Checkpoint B) import `./database` directly — they do
 * NOT go through RPC.
 */
import type { Bridge } from '../bridge';
import * as db from './database';
import { searchGlobal } from './search';

type AnyFn = (...args: unknown[]) => unknown;

// Whitelist of DB functions exposed to main. Keep alphabetised for diff-ability.
// Only include functions that actually have a main-side caller.
const EXPOSED: Record<string, AnyFn> = {
  addPinnedProject: db.addPinnedProject as unknown as AnyFn,
  agentIdFilePath: db.agentIdFilePath as unknown as AnyFn,
  appendSessionChannelMessage:
    db.appendSessionChannelMessage as unknown as AnyFn,
  claimContextInjections: db.claimContextInjections as unknown as AnyFn,
  clearHistory: db.clearHistory as unknown as AnyFn,
  clearSessionChannelMessages:
    db.clearSessionChannelMessages as unknown as AnyFn,
  createFolder: db.createFolder as unknown as AnyFn,
  createSessionChannel: db.createSessionChannel as unknown as AnyFn,
  deleteContextInjectionsForSession:
    db.deleteContextInjectionsForSession as unknown as AnyFn,
  deleteFolder: db.deleteFolder as unknown as AnyFn,
  deleteRegisteredConnection: db.deleteRegisteredConnection as unknown as AnyFn,
  deleteSessionChannel: db.deleteSessionChannel as unknown as AnyFn,
  deleteSkillOrInstruction: db.deleteSkillOrInstruction as unknown as AnyFn,
  duplicateSkillOrInstruction:
    db.duplicateSkillOrInstruction as unknown as AnyFn,
  getActiveSessionChannels: db.getActiveSessionChannels as unknown as AnyFn,
  getAllRegisteredConnections:
    db.getAllRegisteredConnections as unknown as AnyFn,
  getConversationHistory: db.getConversationHistory as unknown as AnyFn,
  getMissingBuiltinCount: db.getMissingBuiltinCount as unknown as AnyFn,
  getPinnedProjects: db.getPinnedProjects as unknown as AnyFn,
  getRegisteredConnection: db.getRegisteredConnection as unknown as AnyFn,
  getRegisteredConnectionBySessionId:
    db.getRegisteredConnectionBySessionId as unknown as AnyFn,
  getRegisteredConnectionsByConnectionId:
    db.getRegisteredConnectionsByConnectionId as unknown as AnyFn,
  getRegisteredConnectionsByProvider:
    db.getRegisteredConnectionsByProvider as unknown as AnyFn,
  getSessionChannelHistory: db.getSessionChannelHistory as unknown as AnyFn,
  getSkillOrInstructionByName:
    db.getSkillOrInstructionByName as unknown as AnyFn,
  getUnsentCount: db.getUnsentCount as unknown as AnyFn,
  getUnsentMessages: db.getUnsentMessages as unknown as AnyFn,
  isProviderSessionClaimed: db.isProviderSessionClaimed as unknown as AnyFn,
  listFolders: db.listFolders as unknown as AnyFn,
  listSessionMutedEntryNames: db.listSessionMutedEntryNames as unknown as AnyFn,
  listSessionScopedEntryNames:
    db.listSessionScopedEntryNames as unknown as AnyFn,
  listSkillsAndInstructions: db.listSkillsAndInstructions as unknown as AnyFn,
  markMessagesSent: db.markMessagesSent as unknown as AnyFn,
  queueSessionMessage: db.queueSessionMessage as unknown as AnyFn,
  removePinnedProject: db.removePinnedProject as unknown as AnyFn,
  renameFolder: db.renameFolder as unknown as AnyFn,
  resetBuiltinTemplates: db.resetBuiltinTemplates as unknown as AnyFn,
  resetDatabase: db.resetDatabase as unknown as AnyFn,
  saveConversation: db.saveConversation as unknown as AnyFn,
  searchGlobal: searchGlobal as unknown as AnyFn,
  seedBuiltinTemplates: db.seedBuiltinTemplates as unknown as AnyFn,
  setEntryFolder: db.setEntryFolder as unknown as AnyFn,
  setEntryInjectionMode: db.setEntryInjectionMode as unknown as AnyFn,
  setEntryScope: db.setEntryScope as unknown as AnyFn,
  setSessionMutedEntries: db.setSessionMutedEntries as unknown as AnyFn,
  setSessionScopedEntries: db.setSessionScopedEntries as unknown as AnyFn,
  toggleSkillOrInstructionEnabled:
    db.toggleSkillOrInstructionEnabled as unknown as AnyFn,
  updateConnectionId: db.updateConnectionId as unknown as AnyFn,
  upsertContextInjection: db.upsertContextInjection as unknown as AnyFn,
  upsertRegisteredConnection: db.upsertRegisteredConnection as unknown as AnyFn,
  upsertSkillOrInstruction: db.upsertSkillOrInstruction as unknown as AnyFn,
};

export function registerDbRpcHandlers(bridge: Bridge): void {
  for (const [name, fn] of Object.entries(EXPOSED)) {
    bridge.handle(`db.${name}`, (payload) => {
      const p = payload as { args?: unknown[] } | undefined;
      const args = Array.isArray(p?.args) ? p!.args : [];
      return fn(...args);
    });
  }
}

export const EXPOSED_DB_FUNCTION_NAMES = Object.keys(EXPOSED);
