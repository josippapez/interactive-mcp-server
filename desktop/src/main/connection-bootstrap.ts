import type { RegisteredConnection } from './database';

export interface ConnectionBootstrapProfile {
  channelName: string;
  projectName: string;
  baseDirectory: string | null;
}

const DEFAULT_AGENT_NAME = 'OpenCode - Main Channel';
const DEFAULT_PROJECT_NAME = 'interactive-mcp-server';

export function resolveConnectionBootstrapProfile(
  registeredConnections: RegisteredConnection[],
): ConnectionBootstrapProfile {
  const preferMain = [...registeredConnections]
    .reverse()
    .find((rc) => rc.channelName === DEFAULT_AGENT_NAME);
  const latest =
    registeredConnections[registeredConnections.length - 1] ?? null;
  const picked = preferMain ?? latest;

  if (!picked) {
    return {
      channelName: DEFAULT_AGENT_NAME,
      projectName: DEFAULT_PROJECT_NAME,
      baseDirectory: null,
    };
  }

  return {
    channelName: picked.channelName,
    projectName: picked.projectName,
    baseDirectory: picked.baseDirectory,
  };
}
