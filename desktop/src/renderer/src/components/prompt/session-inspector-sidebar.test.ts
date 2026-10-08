import { describe, expect, it } from 'vitest';
import {
  getInspectorTabCounts,
  getInitialInspectorTab,
} from './session-inspector-sidebar';

describe('session inspector tab helpers', () => {
  it('counts tab badges from subagents, todos, and review files', () => {
    expect(
      getInspectorTabCounts({
        backgroundSubagentCount: 3,
        runningSubagentCount: 2,
        todoCount: 5,
        reviewCount: 7,
      }),
    ).toEqual({
      subagents: 3,
      runningSubagents: 2,
      tasks: 5,
      review: 7,
    });
  });

  it('prefers subagents, then tasks, then review for the first meaningful tab', () => {
    expect(
      getInitialInspectorTab({
        backgroundSubagentCount: 1,
        todoCount: 3,
        reviewCount: 2,
      }),
    ).toBe('subagents');

    expect(
      getInitialInspectorTab({
        backgroundSubagentCount: 0,
        todoCount: 3,
        reviewCount: 2,
      }),
    ).toBe('tasks');

    expect(
      getInitialInspectorTab({
        backgroundSubagentCount: 0,
        todoCount: 0,
        reviewCount: 2,
      }),
    ).toBe('review');
  });

  it('keeps the inspector anchored on subagents when everything is empty', () => {
    expect(
      getInitialInspectorTab({
        backgroundSubagentCount: 0,
        todoCount: 0,
        reviewCount: 0,
      }),
    ).toBe('subagents');
  });
});
