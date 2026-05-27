import { describe, expect, it } from 'vitest';
import {
  MCP_STATUS_REFRESH_EVENT,
  shouldRefreshMcpStatusForBatch,
} from './useMcpServers';

describe('useMcpServers helpers', () => {
  it('refreshes MCP status when OpenCode reports tool changes', () => {
    expect(
      shouldRefreshMcpStatusForBatch({
        events: [{ type: 'mcp.tools.changed', server: 'interactive-desktop' }],
      }),
    ).toBe(true);
  });

  it('ignores unrelated conversation events', () => {
    expect(
      shouldRefreshMcpStatusForBatch({
        events: [{ type: 'installation.update-available', version: '1.0.0' }],
      }),
    ).toBe(false);
  });

  it('exposes a shared event name for status refresh requests', () => {
    expect(MCP_STATUS_REFRESH_EVENT).toBe('interactive-mcp:mcp-status-refresh');
  });
});
