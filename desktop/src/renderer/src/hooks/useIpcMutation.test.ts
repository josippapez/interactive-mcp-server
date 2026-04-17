import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '@/lib/ipc-result';
import {
  INITIAL_IPC_MUTATION_STATE,
  ipcMutationReset,
  ipcMutationSettle,
  ipcMutationStart,
  type IpcMutationState,
} from './useIpcMutation';
import { runIpcQuery } from './useIpcQuery';

describe('useIpcMutation — pure state transitions', () => {
  it('INITIAL_IPC_MUTATION_STATE is cleared', () => {
    expect(INITIAL_IPC_MUTATION_STATE).toEqual({
      data: null,
      error: null,
      loading: false,
    });
  });

  it('ipcMutationStart sets loading, clears error, preserves data', () => {
    const prev: IpcMutationState<number> = {
      data: 5,
      error: 'old',
      loading: false,
    };
    expect(ipcMutationStart(prev)).toEqual({
      data: 5,
      error: null,
      loading: true,
    });
  });

  it('ipcMutationSettle(ok) → data, no error, not loading', () => {
    expect(ipcMutationSettle<number>({ ok: true, data: 7 })).toEqual({
      data: 7,
      error: null,
      loading: false,
    });
  });

  it('ipcMutationSettle(err) → null data, error, not loading', () => {
    expect(ipcMutationSettle<number>({ ok: false, error: 'nope' })).toEqual({
      data: null,
      error: 'nope',
      loading: false,
    });
  });

  it('ipcMutationReset clears everything', () => {
    expect(ipcMutationReset<number>()).toEqual({
      data: null,
      error: null,
      loading: false,
    });
  });
});

/**
 * End-to-end simulation of the hook without React. vitest runs in node-env
 * with no DOM; rather than pulling in @testing-library/react (not a dep),
 * we drive the same state-machine the hook uses and assert observable
 * behavior.
 */
describe('useIpcMutation — behavioral harness', () => {
  type State<T> = IpcMutationState<T>;

  function makeHarness<Args extends unknown[], T>(
    mutator: (...args: Args) => Promise<IpcResult<T>>,
  ): {
    state: State<T>;
    mutate: (...args: Args) => Promise<T | null>;
    reset: () => void;
    unmount: () => void;
    readonly loadingLog: ReadonlyArray<boolean>;
  } {
    const state: State<T> = {
      data: null,
      error: null,
      loading: false,
    };
    const loadingLog: boolean[] = [];
    const mountedRef = { current: true };
    const callIdRef = { current: 0 };

    const setState = (next: State<T>): void => {
      state.data = next.data;
      state.error = next.error;
      state.loading = next.loading;
      loadingLog.push(next.loading);
    };

    const mutate = async (...args: Args): Promise<T | null> => {
      const myId = ++callIdRef.current;
      setState(ipcMutationStart(state));
      const result = await runIpcQuery<T>(() => mutator(...args));
      if (!mountedRef.current || callIdRef.current !== myId) {
        return result.ok ? result.data : null;
      }
      setState(ipcMutationSettle(result));
      return result.ok ? result.data : null;
    };

    const reset = (): void => {
      setState(ipcMutationReset<T>());
    };

    return {
      state,
      mutate,
      reset,
      unmount: () => {
        mountedRef.current = false;
      },
      get loadingLog() {
        return loadingLog;
      },
    };
  }

  it('success path: mutate resolves to data and populates state', async () => {
    const mutator = vi.fn(
      async (x: number): Promise<IpcResult<number>> => ({
        ok: true,
        data: x * 2,
      }),
    );
    const h = makeHarness(mutator);

    const out = await h.mutate(21);

    expect(out).toBe(42);
    expect(h.state).toEqual({ data: 42, error: null, loading: false });
    expect(mutator).toHaveBeenCalledWith(21);
  });

  it('error path: mutate resolves to null and sets error', async () => {
    const h = makeHarness<[], number>(async () => ({
      ok: false,
      error: 'denied',
    }));

    const out = await h.mutate();

    expect(out).toBeNull();
    expect(h.state).toEqual({
      data: null,
      error: 'denied',
      loading: false,
    });
  });

  it('error path: thrown Error from mutator is captured as error', async () => {
    const h = makeHarness<[], number>(async () => {
      throw new Error('kaboom');
    });

    const out = await h.mutate();

    expect(out).toBeNull();
    expect(h.state.error).toBe('kaboom');
    expect(h.state.loading).toBe(false);
  });

  it('loading flag transitions: false → true → false on success', async () => {
    const h = makeHarness<[], number>(async () => ({ ok: true, data: 1 }));
    expect(h.state.loading).toBe(false);
    const p = h.mutate();
    expect(h.state.loading).toBe(true);
    await p;
    expect(h.state.loading).toBe(false);
    expect(h.loadingLog).toEqual([true, false]);
  });

  it('loading flag transitions: false → true → false on error', async () => {
    const h = makeHarness<[], number>(async () => ({
      ok: false,
      error: 'x',
    }));
    const p = h.mutate();
    expect(h.state.loading).toBe(true);
    await p;
    expect(h.state.loading).toBe(false);
  });

  it('reset clears data, error, and loading', async () => {
    const h = makeHarness<[], number>(async () => ({ ok: true, data: 9 }));
    await h.mutate();
    expect(h.state.data).toBe(9);
    h.reset();
    expect(h.state).toEqual({ data: null, error: null, loading: false });
  });

  it('reset clears error from a previous failure', async () => {
    const h = makeHarness<[], number>(async () => ({
      ok: false,
      error: 'bad',
    }));
    await h.mutate();
    expect(h.state.error).toBe('bad');
    h.reset();
    expect(h.state.error).toBeNull();
  });

  it('stale response: earlier call resolving after a newer call is ignored', async () => {
    let resolveA!: (r: IpcResult<string>) => void;
    const a = new Promise<IpcResult<string>>((res) => {
      resolveA = res;
    });
    const calls: Array<Promise<IpcResult<string>>> = [
      a,
      Promise.resolve<IpcResult<string>>({ ok: true, data: 'B' }),
    ];
    let i = 0;
    const h = makeHarness<[], string>(() => calls[i++]!);

    const pA = h.mutate();
    const pB = h.mutate();
    await pB;
    expect(h.state.data).toBe('B');

    resolveA({ ok: true, data: 'A' });
    await pA;

    // Stale A must NOT overwrite the fresher B payload.
    expect(h.state.data).toBe('B');
  });

  it('unmount while mutating: state is not touched after unmount', async () => {
    let resolver!: (r: IpcResult<number>) => void;
    const pending = new Promise<IpcResult<number>>((res) => {
      resolver = res;
    });
    const h = makeHarness<[], number>(() => pending);

    const p = h.mutate();
    expect(h.state.loading).toBe(true);
    h.unmount();
    resolver({ ok: true, data: 1 });
    const out = await p;

    // The promise still resolves to the data (caller awaited it), but state
    // was not mutated after unmount.
    expect(out).toBe(1);
    expect(h.state.data).toBeNull();
    expect(h.state.loading).toBe(true);
  });
});
