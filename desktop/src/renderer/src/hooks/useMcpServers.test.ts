import { describe, expect, it } from 'vitest';
import { shouldRefreshMcpStatusForBatch } from './useMcpServers';

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
});
