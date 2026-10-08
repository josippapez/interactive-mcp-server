import { describe, expect, it } from 'vitest';
import type { Todo } from '../../hooks/useTodos';
import {
  getTodoDockSummary,
  getTodoPreview,
  getTodosForDockDisplay,
} from './session-todo-dock-helpers';

const todo = (content: string, status: Todo['status']): Todo => ({
  content,
  status,
  priority: 'medium',
});

describe('session todo dock helpers', () => {
  it('preserves the server todo order for display', () => {
    const displayed = getTodosForDockDisplay([
      todo('done', 'completed'),
      todo('next', 'pending'),
      todo('working', 'in_progress'),
      todo('skipped', 'cancelled'),
    ]);

    expect(displayed.map((item) => item.content)).toEqual([
      'done',
      'next',
      'working',
      'skipped',
    ]);
  });

  it('summarizes completed progress and active count', () => {
    expect(
      getTodoDockSummary([
        todo('working', 'in_progress'),
        todo('done', 'completed'),
        todo('next', 'pending'),
        todo('skipped', 'cancelled'),
      ]),
    ).toEqual({ completedCount: 1, totalCount: 4, activeCount: 2 });
  });

  it('previews in-progress, then pending, then latest completed todo', () => {
    expect(
      getTodoPreview([
        todo('done one', 'completed'),
        todo('pending', 'pending'),
        todo('working', 'in_progress'),
      ]),
    ).toBe('working');

    expect(
      getTodoPreview([
        todo('done one', 'completed'),
        todo('pending', 'pending'),
      ]),
    ).toBe('pending');

    expect(
      getTodoPreview([
        todo('done one', 'completed'),
        todo('done two', 'completed'),
      ]),
    ).toBe('done two');
  });
});
