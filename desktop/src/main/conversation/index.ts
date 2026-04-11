/**
 * Conversation mirroring module.
 *
 * Provides an abstract layer for mirroring conversations from
 * various AI providers (OpenCode, Claude SDK, etc.) into the desktop app.
 */

// Types
export type {
  MessageRole,
  PartType,
  MessagePart,
  ConversationMessage,
  ConversationEventType,
  ConversationEvent,
  ConversationEventCallback,
  ConversationProvider,
  ConversationProviderRegistry,
} from './types';

// Registry
export { getConversationRegistry, ConversationRegistry } from './registry';

// Providers
export {
  OpenCodeConversationProvider,
  getOpenCodeConversationProvider,
} from './opencode-provider';

// IPC handlers
export {
  initializeConversationProviders,
  updateConversationPort,
  stopConversationProviders,
  registerConversationHandlers,
  type ConversationHandlerDeps,
} from './handlers';
