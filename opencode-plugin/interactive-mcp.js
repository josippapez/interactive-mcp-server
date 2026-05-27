import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{ directory?: string, worktree?: string, serverUrl?: URL }} PluginInput
 * @typedef {{ type: 'local', command: string[], enabled?: boolean, environment?: Record<string, string>, timeout?: number }} LocalMcpConfig
 * @typedef {{ type: 'remote', url: string, enabled?: boolean, timeout?: number }} RemoteMcpConfig
 * @typedef {{ mcp?: Record<string, LocalMcpConfig | RemoteMcpConfig> }} OpenCodeConfig
 * @typedef {{ config: (config: OpenCodeConfig) => void | Promise<void> }} PluginHooks
 */

/**
 * @param {PluginInput} input
 * @returns {Promise<PluginHooks>}
 */
export default async function interactiveMcpPlugin({
  worktree,
  directory,
  serverUrl,
}) {
  const repositoryRoot = worktree || directory;
  if (!repositoryRoot) {
    throw new Error('interactive-mcp plugin requires an OpenCode directory.');
  }
  const openCodeServerUrl = serverUrl?.href || 'http://localhost:4096';
  /** @type {Record<string, string>} */
  const environment = {};
  if (process.env.OPENCODE_SERVER_PASSWORD) {
    environment.OPENCODE_SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;
  }
  if (process.env.OPENCODE_SERVER_USERNAME) {
    environment.OPENCODE_SERVER_USERNAME = process.env.OPENCODE_SERVER_USERNAME;
  }

  return {
    config: async (config) => {
      config.mcp = {
        ...config.mcp,
        'interactive-mcp-standalone': {
          type: 'local',
          command: [
            'node',
            join(pluginDirectory, 'standalone-mcp.cjs'),
            repositoryRoot,
            openCodeServerUrl,
          ],
          enabled: true,
          environment,
          timeout: 30000,
        },
      };
    },
  };
}
