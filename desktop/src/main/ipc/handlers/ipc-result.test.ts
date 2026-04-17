import { describe, it, expect } from 'vitest';
import { errorMessage, withIpcResult, type IpcResult } from './ipc-result';

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a stringified value for non-Error throws', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('stringifies object throws via String()', () => {
    expect(errorMessage({ foo: 'bar' })).toBe('[object Object]');
  });
});

describe('withIpcResult', () => {
  it('wraps a sync handler return value as { ok: true, data }', async () => {
    const wrapped = withIpcResult((n: number) => n * 2);
    const result = await wrapped(21);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it('awaits an async handler and wraps the resolved value', async () => {
    const wrapped = withIpcResult(async (prefix: string) => `${prefix}!`);
    const result = await wrapped('hello');
    expect(result).toEqual({ ok: true, data: 'hello!' });
  });

  it('catches thrown Error instances and returns { ok: false, error }', async () => {
    const wrapped = withIpcResult(async () => {
      throw new Error('database down');
    });
    const result = await wrapped();
    expect(result).toEqual({ ok: false, error: 'database down' });
  });

  it('catches non-Error throws and stringifies them', async () => {
    const wrapped = withIpcResult(async () => {
      throw 'legacy string error';
    });
    const result = await wrapped();
    expect(result).toEqual({ ok: false, error: 'legacy string error' });
  });

  it('forwards multiple arguments to the wrapped handler', async () => {
    const wrapped = withIpcResult(
      async (a: number, b: number, c: number) => a + b + c,
    );
    const result = await wrapped(1, 2, 3);
    expect(result).toEqual({ ok: true, data: 6 });
  });

  it('returns a Promise even when the handler is synchronous', () => {
    const wrapped = withIpcResult(() => 'sync');
    const ret = wrapped();
    expect(ret).toBeInstanceOf(Promise);
  });

  it('narrows correctly via the IpcResult discriminated union', async () => {
    const wrapped = withIpcResult(async (shouldFail: boolean) => {
      if (shouldFail) throw new Error('fail');
      return { value: 1 };
    });
    const ok: IpcResult<{ value: number }> = await wrapped(false);
    if (ok.ok) {
      expect(ok.data.value).toBe(1);
    } else {
      throw new Error('expected ok=true branch');
    }
    const err = await wrapped(true);
    if (!err.ok) {
      expect(err.error).toBe('fail');
    } else {
      throw new Error('expected ok=false branch');
    }
  });
});
