import { describe, expect, it } from 'vitest';
import type { BackgroundSubagentDisplay } from '../../pages/prompt/background-subagents';
import type { Todo } from '../../hooks/useTodos';
import {
  buildSessionInspectorSubagentRows,
  getSessionInspectorTabSummaries,
  isSessionInspectorTab,
  resolveSessionInspectorTab,
  type SessionInspectorTab,
} from './session-inspector-utils';

const subagent = (
  overrides: Partial<BackgroundSubagentDisplay>,
): BackgroundSubagentDisplay => ({
  id: 'ses_child',
  title: 'Explore renderer',
  status: 'running',
  depth: 1,
  createdAt: 1_700_000_000_000,
  model: null,
  variant: null,
  isStalled: false,
  ...overrides,
});

const todo = (status: Todo['status']): Todo => ({
  content: `${status} task`,
  status,
  priority: 'medium',
});

describe('session inspector utils', () => {
  it('summarizes tab badges from subagents, todos, and review files', () => {
    const summaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [
        subagent({ id: 'running', status: 'running' }),
        subagent({ id: 'ended', status: 'ended' }),
      ],
      todos: [
        todo('completed'),
        todo('pending'),
        todo('in_progress'),
        todo('cancelled'),
      ],
      reviewFileCount: 3,
      reviewLoading: false,
      reviewError: null,
    });

    expect(summaries).toEqual([
      {
        id: 'subagents',
        label: 'Subagents',
        badge: '1',
        hasContent: true,
        hasIssue: false,
      },
      {
        id: 'tasks',
        label: 'Tasks',
        badge: '2',
        hasContent: true,
        hasIssue: false,
      },
      {
        id: 'review',
        label: 'Review',
        badge: '3',
        hasContent: true,
        hasIssue: false,
      },
    ]);
  });

  it('prefers the first tab with content when no tab is requested', () => {
    const summaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [],
      todos: [todo('pending')],
      reviewFileCount: 0,
      reviewLoading: false,
      reviewError: null,
    });

    expect(resolveSessionInspectorTab('subagents', summaries)).toBe(
      'subagents',
    );
    expect(resolveSessionInspectorTab(undefined, summaries)).toBe('tasks');
  });

  it('keeps review selected while review loading or errored', () => {
    const loadingSummaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [],
      todos: [],
      reviewFileCount: 0,
      reviewLoading: true,
      reviewError: null,
    });
    const errorSummaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [],
      todos: [],
      reviewFileCount: 0,
      reviewLoading: false,
      reviewError: 'Unable to load changes',
    });

    expect(resolveSessionInspectorTab(undefined, loadingSummaries)).toBe(
      'review',
    );
    expect(resolveSessionInspectorTab('review', errorSummaries)).toBe('review');
  });

  it('falls back to subagents when all tabs are empty', () => {
    const summaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [],
      todos: [],
      reviewFileCount: 0,
      reviewLoading: false,
      reviewError: null,
    });

    expect(resolveSessionInspectorTab(undefined, summaries)).toBe('subagents');
  });

  it('sorts running and stalled subagent rows before ended rows', () => {
    const rows = buildSessionInspectorSubagentRows([
      subagent({
        id: 'ended',
        title: 'Ended',
        status: 'ended',
        createdAt: 1_700_000_000_000,
        activityAt: 1_700_000_000_100,
      }),
      subagent({
        id: 'stalled',
        title: 'Stalled',
        status: 'running',
        isStalled: true,
        createdAt: 1_700_000_000_001,
        activityAt: 1_700_000_000_001,
        model: 'gpt-5',
        variant: 'analysis',
      }),
      subagent({
        id: 'running',
        title: 'Running',
        status: 'running',
        createdAt: 1_700_000_000_002,
        activityAt: 1_700_000_000_002,
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(['stalled', 'running', 'ended']);
    expect(rows[0]).toMatchObject({
      id: 'stalled',
      statusLabel: 'Stalled',
      tone: 'warning',
      meta: 'gpt-5 / analysis',
    });
  });

  it('uses status summaries when model metadata is unavailable', () => {
    const rows = buildSessionInspectorSubagentRows([
      subagent({
        id: 'running',
        model: null,
        variant: null,
        statusSummary: 'Running for 4m',
      }),
    ]);

    expect(rows[0].meta).toBe('Running for 4m');
  });

  it('accepts every declared tab id', () => {
    const summaries = getSessionInspectorTabSummaries({
      backgroundSubagents: [],
      todos: [],
      reviewFileCount: 0,
      reviewLoading: false,
      reviewError: null,
    });

    const tabs: SessionInspectorTab[] = ['subagents', 'tasks', 'review'];
    expect(
      tabs.map((tab) => resolveSessionInspectorTab(tab, summaries)),
    ).toEqual(tabs);
    expect(tabs.every((tab) => isSessionInspectorTab(tab))).toBe(true);
    expect(isSessionInspectorTab('activity')).toBe(false);
  });
});
