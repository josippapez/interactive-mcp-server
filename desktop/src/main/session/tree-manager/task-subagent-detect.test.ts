import { describe, it, expect } from 'vitest';
import {
  isTaskToolPart,
  resolveChildSessionIdFromTaskPart,
} from './task-subagent-detect';

describe('isTaskToolPart', () => {
  it('matches lowercase "task"', () => {
    expect(isTaskToolPart({ tool: 'task' })).toBe(true);
  });

  it('matches uppercase "Task" (case-insensitive)', () => {
    expect(isTaskToolPart({ tool: 'Task' })).toBe(true);
  });

  it('matches all-caps "TASK" (case-insensitive)', () => {
    expect(isTaskToolPart({ tool: 'TASK' })).toBe(true);
  });

  it('does not match unrelated tools', () => {
    expect(isTaskToolPart({ tool: 'bash' })).toBe(false);
    expect(isTaskToolPart({ tool: 'read' })).toBe(false);
  });

  it('returns false when tool is missing', () => {
    expect(isTaskToolPart({})).toBe(false);
  });

  it('returns false when tool is not a string', () => {
    expect(isTaskToolPart({ tool: 42 })).toBe(false);
    expect(isTaskToolPart({ tool: null })).toBe(false);
  });
});

describe('resolveChildSessionIdFromTaskPart', () => {
  it('resolves child id from metadata.sessionId (lowercase — legacy)', () => {
    const part = {
      tool: 'task',
      state: { metadata: { sessionId: 'child-abc' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('child-abc');
  });

  it('resolves child id from metadata.sessionID (uppercase ID)', () => {
    const part = {
      tool: 'task',
      state: { metadata: { sessionID: 'child-xyz' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('child-xyz');
  });

  it('resolves child id from metadata.childSessionID', () => {
    const part = {
      tool: 'task',
      state: { metadata: { childSessionID: 'child-123' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('child-123');
  });

  it('resolves child id when tool name is "Task" (case-insensitive)', () => {
    const part = {
      tool: 'Task',
      state: { metadata: { sessionId: 'child-cap' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('child-cap');
  });

  it('prefers sessionId over sessionID over childSessionID', () => {
    const part = {
      tool: 'task',
      state: {
        metadata: {
          sessionId: 'first',
          sessionID: 'second',
          childSessionID: 'third',
        },
      },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('first');
  });

  it('falls through to sessionID when sessionId is missing', () => {
    const part = {
      tool: 'task',
      state: {
        metadata: { sessionID: 'second', childSessionID: 'third' },
      },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBe('second');
  });

  it('returns null for non-task tools even with metadata.sessionId set', () => {
    const part = {
      tool: 'bash',
      state: { metadata: { sessionId: 'child-abc' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBeNull();
  });

  it('returns null when metadata is missing', () => {
    expect(
      resolveChildSessionIdFromTaskPart({ tool: 'task', state: {} }),
    ).toBeNull();
  });

  it('returns null when state is missing', () => {
    expect(resolveChildSessionIdFromTaskPart({ tool: 'task' })).toBeNull();
  });

  it('returns null when no recognised key carries a string value', () => {
    const part = {
      tool: 'task',
      state: { metadata: { unrelatedKey: 'nope' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBeNull();
  });

  it('returns null when candidate id is empty string', () => {
    const part = {
      tool: 'task',
      state: { metadata: { sessionId: '' } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBeNull();
  });

  it('returns null when candidate id is not a string', () => {
    const part = {
      tool: 'task',
      state: { metadata: { sessionId: 123 } },
    };
    expect(resolveChildSessionIdFromTaskPart(part)).toBeNull();
  });
});
