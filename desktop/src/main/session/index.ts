// Session module barrel file
// Re-exports the public APIs for session helpers.
//
// After Phase 4b:
//   - resolver / auto-register / tree-service / reconnect     → utility/session-client
//   - file (mcp-session-file helpers), registration-cleanup   → utility/backend/session
//   - channel-cleanup                                         → still main-side (orphan helper)

// channel-cleanup (still main-side, pure)
export {
  findStaleGenericDirectChannels,
  type PersistedChannel,
} from './channel-cleanup';

// reconnect (now lives in utility; async proxy)
export {
  reconcileSessionConnections,
  type ReconnectResult,
} from '../utility/session-client';

// resolver (now lives in utility; async proxy)
export {
  resolveSession,
  reResolveStaleSession,
  resolveProviderSessionId,
  type ResolutionMethod,
  type ResolvedSession,
  type ResolverOptions,
} from '../utility/session-client';

// session-tree-service (now lives in utility; async proxy)
export {
  startSessionTreeService,
  stopSessionTreeService,
  fetchSessionTree,
  invalidateSessionTree,
  tombstoneOpenCodeSession,
  getSelectedFolder,
  setSelectedFolder,
} from '../utility/session-client';

// Shared session-tree data types (re-exported from utility backend).
export type {
  SessionNodeData,
  VcsInfo,
  SessionInfo,
} from '../utility/session-client';
