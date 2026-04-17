import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '@/lib/ipc-result';
import { reduceIpcQueryResult, runIpcQuery } from './useIpcQuery';

describe('useIpcQuery — pure helpers', () => {
  describe('reduceIpcQueryResult', () => {
    it('maps ok → { data, error: null }', () => {
      const out = reduceIpcQueryResult<number>({ ok: true, data: 7 });
      expect(out).toEqual({ data: 7, error: null });
    });

    it('maps err → { data: null, error }', () => {
      const out = reduceIpcQueryResult<number>({ ok: false, error: 'nope' });
      expect(out).toEqual({ data: null, error: 'nope' });
    });
  });

  describe('runIpcQuery', () => {
    it('returns the fetcher result verbatim on success', async () => {
      const fetcher = vi.fn<() => Promise<IpcResult<string>>>(async () => ({
        ok: true,
        data: 'hi',
      }));

      const result = await runIpcQuery(fetcher);

      expect(result).toEqual({ ok: true, data: 'hi' });
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it('returns the fetcher result verbatim on IpcResult error', async () => {
      const result = await runIpcQuery(async () => ({
        ok: false,
        error: 'transport said no',
      }));
      expect(result).toEqual({ ok: false, error: 'transport said no' });
    });

    it('converts a thrown Error into an IpcResult error', async () => {
      const result = await runIpcQuery(async () => {
        throw new Error('boom');
      });
      expect(result).toEqual({ ok: false, error: 'boom' });
    });

    it('converts a thrown non-Error into "Unknown IPC failure"', async () => {
      const result = await runIpcQuery(async () => {
        throw 'weird';
      });
      expect(result).toEqual({ ok: false, error: 'Unknown IPC failure' });
    });
  });

  /**
   * Tests below simulate the hook's own concurrency / unmount logic using
   * the same refs-based state machine the hook uses. vitest runs in a Node
   * env with no DOM, so this is the closest we can get to a "hook test"
   * without `@testing-library/react`. The real hook is a thin wrapper over
   * `runIpcQuery` + `reduceIpcQueryResult`, both covered above.
   */
  describe('staleness guard simulation', () => {
    type State<T> = {
      data: T | null;
      error: string | null;
      loading: boolean;
    };

    function makeHarness<T>(): {
      state: State<T>;
      dispatchFetch: (fetcher: () => Promise<IpcResult<T>>) => Promise<void>;
      unmount: () => void;
    } {
      const state: State<T> = { data: null, error: null, loading: true };
      const mountedRef = { current: true };
      const fetchIdRef = { current: 0 };

      const dispatchFetch = async (
        fetcher: () => Promise<IpcResult<T>>,
      ): Promise<void> => {
        const myId = ++fetchIdRef.current;
        state.loading = true;
        state.error = null;
        const result = await runIpcQuery(fetcher);
        if (!mountedRef.current || fetchIdRef.current !== myId) return;
        const reduced = reduceIpcQueryResult(result);
        state.data = reduced.data;
        state.error = reduced.error;
        state.loading = false;
      };

      return {
        state,
        dispatchFetch,
        unmount: () => {
          mountedRef.current = false;
        },
      };
    }

    it('initial load sets data + clears loading', async () => {
      const h = makeHarness<number>();
      await h.dispatchFetch(async () => ({ ok: true, data: 42 }));
      expect(h.state).toEqual({ data: 42, error: null, loading: false });
    });

    it('refetch replaces previous data', async () => {
      const h = makeHarness<number>();
      await h.dispatchFetch(async () => ({ ok: true, data: 1 }));
      await h.dispatchFetch(async () => ({ ok: true, data: 2 }));
      expect(h.state.data).toBe(2);
    });

    it('error state exposes error message and clears data', async () => {
      const h = makeHarness<number>();
      await h.dispatchFetch(async () => ({ ok: false, error: 'x' }));
      expect(h.state).toEqual({ data: null, error: 'x', loading: false });
    });

    it('stale response from earlier call is ignored when newer call has started', async () => {
      const h = makeHarness<number>();

      let resolveSlow!: (r: IpcResult<number>) => void;
      const slow = new Promise<IpcResult<number>>((res) => {
        resolveSlow = res;
      });

      // first (slow) dispatch
      const firstDone = h.dispatchFetch(() => slow);
      // second (fast) dispatch starts and finishes before the slow one
      await h.dispatchFetch(async () => ({
        ok: true,
        data: 'fast' as unknown as number,
      }));
      // now resolve the first one — its result must be discarded
      resolveSlow({ ok: true, data: 'slow' as unknown as number });
      await firstDone;

      expect(h.state.data).toBe('fast');
    });

    it('unmount while loading does NOT mutate state', async () => {
      const h = makeHarness<number>();
      let resolver!: (r: IpcResult<number>) => void;
      const pending = new Promise<IpcResult<number>>((res) => {
        resolver = res;
      });

      const dispatch = h.dispatchFetch(() => pending);
      h.unmount();
      resolver({ ok: true, data: 999 });
      await dispatch;

      // After unmount, state must remain at its pre-settle value.
      expect(h.state.data).toBeNull();
      // loading remained true because the guard short-circuited the settle.
      expect(h.state.loading).toBe(true);
    });
  });
});
