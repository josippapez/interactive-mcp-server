import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProviderType } from '../tools/register-connection';

export interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  connectionId: string;
  connectionName: string;
  providerType: ProviderType;
}

export type SessionMap = Record<string, SessionEntry>;

export interface SessionSummary {
  connectionId: string;
  connectionName: string;
  isRegistered: boolean;
}
