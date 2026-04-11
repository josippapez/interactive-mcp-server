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

// config-sync.ts
export { syncRemoteConfig } from './config-sync';

// health.ts
export { checkOpenCodeHealth, type OpenCodeHealthStatus } from './health';

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
