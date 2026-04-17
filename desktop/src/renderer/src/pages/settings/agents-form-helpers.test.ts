import { describe, it, expect } from 'vitest';
import {
  isValidAgentName,
  parseToolsInput,
  formatToolsForInput,
  buildWriteAgentParams,
} from './agents-form-helpers';

describe('isValidAgentName', () => {
  it('accepts alphanumerics, dash and underscore', () => {
    expect(isValidAgentName('my-agent_1')).toBe(true);
    expect(isValidAgentName('Agent')).toBe(true);
    expect(isValidAgentName('a')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidAgentName('')).toBe(false);
  });

  it('rejects names with invalid characters', () => {
    expect(isValidAgentName('my agent')).toBe(false);
    expect(isValidAgentName('my/agent')).toBe(false);
    expect(isValidAgentName('my.agent')).toBe(false);
    expect(isValidAgentName('my@agent')).toBe(false);
  });
});

describe('parseToolsInput', () => {
  it('parses comma-separated list into Record<string,boolean>', () => {
    expect(parseToolsInput('read, write, bash')).toEqual({
      read: true,
      write: true,
      bash: true,
    });
  });

  it('returns empty object for empty string', () => {
    expect(parseToolsInput('')).toEqual({});
    expect(parseToolsInput('   ')).toEqual({});
  });

  it('ignores empty segments', () => {
    expect(parseToolsInput('a,,b,')).toEqual({ a: true, b: true });
  });

  it('trims whitespace from each tool', () => {
    expect(parseToolsInput('  read ,  write  ')).toEqual({
      read: true,
      write: true,
    });
  });
});

describe('formatToolsForInput', () => {
  it('formats Record<string,boolean> back to comma-separated string of enabled tools', () => {
    expect(formatToolsForInput({ read: true, write: true, bash: false })).toBe(
      'read, write',
    );
  });

  it('returns empty string for empty/undefined input', () => {
    expect(formatToolsForInput({})).toBe('');
    expect(formatToolsForInput(undefined)).toBe('');
  });
});

describe('buildWriteAgentParams', () => {
  it('builds a params object from form state (global scope)', () => {
    const params = buildWriteAgentParams({
      scope: 'global',
      name: 'planner',
      description: 'Planning agent',
      model: 'claude',
      toolsInput: 'read, write',
      body: '# Body',
      baseDirectory: undefined,
    });
    expect(params).toEqual({
      scope: 'global',
      name: 'planner',
      description: 'Planning agent',
      mode: 'subagent',
      model: 'claude',
      tools: { read: true, write: true },
      body: '# Body',
      baseDirectory: undefined,
    });
  });

  it('includes baseDirectory for project scope', () => {
    const params = buildWriteAgentParams({
      scope: 'project',
      name: 'planner',
      description: 'Planning agent',
      model: '',
      toolsInput: '',
      body: '',
      baseDirectory: '/work/project',
    });
    expect(params.scope).toBe('project');
    expect(params.baseDirectory).toBe('/work/project');
    expect(params.tools).toEqual({});
  });

  it('omits model when blank', () => {
    const params = buildWriteAgentParams({
      scope: 'global',
      name: 'x',
      description: 'd',
      model: '   ',
      toolsInput: '',
      body: 'b',
    });
    expect(params.model).toBeUndefined();
  });
});
