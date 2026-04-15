/**
 * Re-exports from the modularized useIpcListeners folder.
 * This file maintains backward compatibility for existing imports.
 */
export {
  useIpcListeners,
  createDirectConnectionNode,
  findKeyByConnectionId,
  findPromptTargetKey,
  collectDescendantKeys,
} from './useIpcListeners/useIpcListeners';

export type {
  IpcListenerOpts,
  SessionStatusType,
} from './useIpcListeners/types';
