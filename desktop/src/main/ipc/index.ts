/**
 * IPC module barrel file.
 * Re-exports all public APIs from the IPC subsystem.
 */

// Channel abstraction for sending messages to renderer
export {
  sendToRenderer,
  sendSessionStatus,
  sendAgentMessage,
  sendIntensiveChatStart,
  sendIntensiveChatStop,
  sendPromptClear,
  type SessionRoutedPayload,
  type SessionStatusPayload,
  type AgentMessagePayload,
  type IntensiveChatStartPayload,
  type IntensiveChatStopPayload,
  type PromptClearPayload,
} from './channel';

// IPC handler registration
export { registerIpcHandlers, type IpcHandlerDeps } from './handlers';

// Prompt system
export {
  promptUser,
  getActivePromptData,
  cancelActivePrompt,
  forceTerminateChat,
  setSoundEnabled,
  setPromptTimeout,
  getPromptTimeoutSeconds,
  type PromptData,
  type PromptResponse,
  type PromptUserFn,
} from './prompt';
