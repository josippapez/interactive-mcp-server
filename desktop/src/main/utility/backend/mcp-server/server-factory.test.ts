import { describe, expect, it } from 'vitest';
import { createMcpServerWithTools } from './server-factory';
import { HIDDEN_TOOL_NAMES } from './tool-list-filter';

function registeredToolNames(server: unknown): Set<string> {
  const internalServer = server as {
    _registeredTools?: Record<string, unknown>;
  };
  return new Set(Object.keys(internalServer._registeredTools ?? {}));
}

describe('createMcpServerWithTools', () => {
  it('registers hidden desktop tools so OpenCode can still call them directly', () => {
    const server = createMcpServerWithTools(
      () => null,
      'connection-1',
      'Agent 1',
      () => 4096,
      () => true,
      () => 'opencode',
      async () => [],
      async () => false,
      { 'x-imcp-provider': 'opencode' },
    );

    const names = registeredToolNames(server);
    expect(names).toContain('find_docs');
    expect(names).toContain('read_doc');
    expect(names).toContain('list_docs');
    expect(names).toContain('find_libs');
    expect(names).toContain('find_repo_docs');
    expect(HIDDEN_TOOL_NAMES.has('find_docs')).toBe(false);
    expect(HIDDEN_TOOL_NAMES.has('read_doc')).toBe(false);
    expect(HIDDEN_TOOL_NAMES.has('list_docs')).toBe(false);
    expect(HIDDEN_TOOL_NAMES.has('find_libs')).toBe(false);
    expect(HIDDEN_TOOL_NAMES.has('find_repo_docs')).toBe(false);
    for (const hiddenName of HIDDEN_TOOL_NAMES) {
      expect(names).toContain(hiddenName);
    }
  });
});
