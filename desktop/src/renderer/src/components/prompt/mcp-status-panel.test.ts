import { describe, expect, it } from 'vitest';
import {
  getVisibleMcpTools,
  shouldRenderMcpStatusPanel,
} from './McpStatusPanel';

describe('McpStatusPanel helpers', () => {
  it('renders immediately even before MCP servers have loaded', () => {
    expect(shouldRenderMcpStatusPanel()).toBe(true);
  });

  it('shows all tools for expanded MCP server details', () => {
    const tools = Array.from({ length: 12 }, (_, index) => ({
      name: `tool-${index + 1}`,
    }));

    expect(getVisibleMcpTools(tools)).toHaveLength(12);
  });
});
