/**
 * OpenCode integration module.
 *
 * Re-exports all public APIs from the opencode-related modules.
 */

// abort.ts
export { abortOpenCodeSession } from './abort';

// auto-register.ts
export {
  startAutoRegisterWithOpenCode,
  type AutoRegisterOptions,
  type RegisterWithOpenCode,
} from './auto-register';

// bus-events.ts
export {
  startBusEventSubscription,
  stopBusEventSubscription,
  _handleBusEventForTest,
} from './bus-events';

// permission-list.ts
export {
  fetchPendingPermissions,
  type PendingPermissionRecord,
} from './permission-list';

// question-list.ts
export {
  fetchPendingQuestions,
  replyToOpenCodeQuestion,
  rejectOpenCodeQuestion,
  type PendingQuestionRecord,
  type PendingQuestionInfo,
  type PendingQuestionOption,
} from './question-list';

// config-sync.ts
export { syncRemoteConfig } from './config-sync';

// health.ts
export { checkOpenCodeHealth, type OpenCodeHealthStatus } from './health';

// sdk-client.ts
export {
  initSdkClient,
  getSdkClient,
  getSdkPort,
  getClient,
  _setClientFactory,
  _resetClientFactory,
} from './sdk-client';

// injector.ts
export {
  injectOpenCodeMessage,
  SUPPORTED_FILE_EXTENSIONS,
  type Attachment,
} from './injector';

// mcp-register.ts
export {
  registerMcpWithOpenCode,
  registerMcpWithRetry,
  type McpRegistrationOptions,
  type McpRegistrationResult,
  type McpRetryOptions,
} from './mcp-register';

// mcp-inject.ts
export {
  injectProjectMcps,
  recordInjectedMcps,
  getInjectedMcps,
  clearInjectedMcps,
  getAllInjectedMcpSessions,
  type McpServerConfig,
  type McpInjectionResult,
  type McpInjectionSummary,
  type McpInjectionOptions,
} from './mcp-inject';

// mcp-status.ts
export {
  fetchMcpStatus,
  connectMcp,
  disconnectMcp,
  registerMcp,
  type McpServerStatus,
  type McpTool,
  type McpResource,
  type McpPrompt,
  type McpStatusResult,
  type McpOperationResult,
} from './mcp-status';

// server.ts
export {
  startOpenCodeServer,
  stopOpenCodeServer,
  isOpenCodeServerRunning,
} from './server';

// session.ts
export {
  autoDetectOpenCodeSession,
  autoDetectOpenCodeSessionId,
  fetchAllOpenCodeSessions,
  collectDescendants,
  createOpenCodeSession,
  type CreateSessionResult,
  type DetectedSession,
  type OpenCodeSession,
} from './session';

// session-status.ts
export {
  fetchSessionStatus,
  type SessionStatusMap,
  type SessionStatusType,
} from './session-status';

// todo.ts
export { fetchTodosForSession, type Todo } from './todo';

// vcs.ts
export { fetchVcsInfo, type VcsInfo } from './vcs';

// context-tracking.ts
export {
  updateSessionTokens,
  setSessionTotalTokens,
  getSessionContextUsage,
  clearSessionContextUsage,
  handleCompaction,
  setModelContextLimit,
  getModelContextLimit,
  triggerCompaction,
  fetchSessionTokens,
  COMPACTION_BUFFER,
  DEFAULT_CONTEXT_WINDOW,
  type MessageTokens,
  type ContextUsage,
  type CompactionResult,
  type SessionInfo as ContextSessionInfo,
} from './context-tracking';

// provider.ts
export {
  fetchProviders,
  fetchModels,
  fetchProvidersInfo,
  getProviderById,
  getModelById,
  getCachedProviders,
  clearProviderCache,
  type Provider,
  type ProviderModel,
  type ProvidersInfo,
  type Model,
} from './provider';

// command.ts
export {
  fetchCommands,
  executeCommand,
  getCachedCommands,
  clearCommandCache,
  getCommandByName,
  type Command,
  type CommandArg,
  type CommandsResponse,
  type ExecuteCommandResult,
} from './command';
