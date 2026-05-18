import { describe, expect, it } from 'vitest';
import { shouldRenderMcpStatusPanel } from './McpStatusPanel';

describe('McpStatusPanel helpers', () => {
  it('renders immediately even before MCP servers have loaded', () => {
    expect(shouldRenderMcpStatusPanel()).toBe(true);
  });
});
