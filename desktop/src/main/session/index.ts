// Session module barrel file
// Re-exports all public APIs from session-related modules

// channel-cleanup
export {
  findStaleGenericDirectChannels,
  type PersistedChannel,
} from './channel-cleanup';

// file
export {
  SESSION_FILE,
  CWD_SESSION_FILE,
  MCP_CONFIG_FILE,
  writeSessionFile,
  writeMcpConfigHint,
  clearSessionFile,
} from './file';

// reconnect
export { reconcileSessionConnections, type ReconnectResult } from './reconnect';

// registration-cleanup
export {
  pickUnregisteredConnectionsForCleanup,
  pickUnregisteredDefaultConnectionsForCleanup,
  type SessionRegistrationEntry,
} from './registration-cleanup';

// resolver
export {
  resolveSession,
  reResolveStaleSession,
  resolveOpenCodeSessionId,
  type ResolutionMethod,
  type ResolvedSession,
  type ResolverOptions,
} from './resolver';

// tree-manager
export {
  tombstoneOpenCodeSession,
  recordPendingConnection,
  startSessionTreeManager,
  stopSessionTreeManager,
  triggerSessionTreeUpdate,
  replayPendingSessionTreeSnapshot,
  refreshSessionTreeCache,
  type VcsInfo,
  type SessionNodeData,
} from './tree-manager';

// tree-poller
export {
  startSessionTreePoller,
  stopSessionTreePoller,
  type DetectedChildSession,
} from './tree-poller';
