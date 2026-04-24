import { describe, expect, it, vi } from 'vitest';

import { createKeyedDebouncer } from './debounce-tree-invalidate';

describe('createKeyedDebouncer', () => {
  it('coalesces multiple schedule() calls for the same key into one action', () => {
    vi.useFakeTimers();
    try {
      const debouncer = createKeyedDebouncer({ windowMs: 200 });
      const action = vi.fn();

      for (let i = 0; i < 10; i++) {
        debouncer.schedule('session-A', action);
      }

      vi.advanceTimersByTime(199);
      expect(action).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(action).toHaveBeenCalledTimes(1);
      expect(debouncer.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps separate timers per key — bursts on one key do not block others', () => {
    vi.useFakeTimers();
    try {
      const debouncer = createKeyedDebouncer({ windowMs: 200 });
      const actionA = vi.fn();
      const actionB = vi.fn();

      debouncer.schedule('A', actionA);
      vi.advanceTimersByTime(100);
      debouncer.schedule('B', actionB);
      // Re-arm A right before its timer would fire so it is delayed.
      vi.advanceTimersByTime(99);
      debouncer.schedule('A', actionA);

      // Fast-forward past B's window but not A's re-armed window.
      vi.advanceTimersByTime(101);
      expect(actionB).toHaveBeenCalledTimes(1);
      expect(actionA).not.toHaveBeenCalled();

      vi.advanceTimersByTime(99);
      expect(actionA).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the latest action passed for a given key', () => {
    vi.useFakeTimers();
    try {
      const debouncer = createKeyedDebouncer({ windowMs: 50 });
      const first = vi.fn();
      const second = vi.fn();
      debouncer.schedule('k', first);
      debouncer.schedule('k', second);

      vi.advanceTimersByTime(50);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() prevents a pending action from running', () => {
    vi.useFakeTimers();
    try {
      const debouncer = createKeyedDebouncer({ windowMs: 100 });
      const action = vi.fn();
      debouncer.schedule('k', action);
      debouncer.cancel('k');
      vi.advanceTimersByTime(500);
      expect(action).not.toHaveBeenCalled();
      expect(debouncer.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelAll() clears every pending key', () => {
    vi.useFakeTimers();
    try {
      const debouncer = createKeyedDebouncer({ windowMs: 100 });
      const a = vi.fn();
      const b = vi.fn();
      debouncer.schedule('a', a);
      debouncer.schedule('b', b);
      expect(debouncer.pendingCount()).toBe(2);
      debouncer.cancelAll();
      vi.advanceTimersByTime(500);
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
      expect(debouncer.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours injected timer functions', () => {
    const handles: Array<{ id: number; cb: () => void }> = [];
    let nextId = 1;
    const setTimeoutFn = (cb: () => void) => {
      const id = nextId++;
      handles.push({ id, cb });
      return id;
    };
    const clearTimeoutFn = vi.fn((h: unknown) => {
      const idx = handles.findIndex((x) => x.id === h);
      if (idx !== -1) handles.splice(idx, 1);
    });

    const debouncer = createKeyedDebouncer({
      windowMs: 100,
      setTimeoutFn,
      clearTimeoutFn,
    });
    const action = vi.fn();
    debouncer.schedule('k', action);
    debouncer.schedule('k', action); // should clear the first
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(1);
    handles[0]!.cb();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
