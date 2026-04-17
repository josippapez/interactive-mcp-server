import { describe, expect, it } from 'vitest';
import {
  isIpcErr,
  isIpcOk,
  unwrapIpc,
  unwrapIpcOr,
  type IpcResult,
} from './ipc-result';

describe('ipc-result', () => {
  describe('isIpcOk', () => {
    it('returns true for ok results', () => {
      const r: IpcResult<number> = { ok: true, data: 1 };
      expect(isIpcOk(r)).toBe(true);
    });

    it('returns false for err results', () => {
      const r: IpcResult<number> = { ok: false, error: 'boom' };
      expect(isIpcOk(r)).toBe(false);
    });
  });

  describe('isIpcErr', () => {
    it('returns true for err results', () => {
      const r: IpcResult<number> = { ok: false, error: 'boom' };
      expect(isIpcErr(r)).toBe(true);
    });

    it('returns false for ok results', () => {
      const r: IpcResult<number> = { ok: true, data: 42 };
      expect(isIpcErr(r)).toBe(false);
    });
  });

  describe('unwrapIpc', () => {
    it('returns data on ok', () => {
      expect(unwrapIpc({ ok: true, data: 'hello' })).toBe('hello');
    });

    it('returns data unchanged for complex payloads', () => {
      const payload = { a: 1, nested: { b: [1, 2, 3] } };
      expect(unwrapIpc({ ok: true, data: payload })).toBe(payload);
    });

    it('throws Error with the error message on !ok', () => {
      const result: IpcResult<number> = { ok: false, error: 'disk full' };
      expect(() => unwrapIpc(result)).toThrow('disk full');
    });

    it('attaches the original result as `cause` on the thrown error', () => {
      const result: IpcResult<number> = { ok: false, error: 'boom' };
      try {
        unwrapIpc(result);
        expect.fail('expected unwrapIpc to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).cause).toBe(result);
      }
    });
  });

  describe('unwrapIpcOr', () => {
    it('returns data on ok', () => {
      expect(unwrapIpcOr({ ok: true, data: 5 }, 0)).toBe(5);
    });

    it('returns fallback on !ok', () => {
      expect(unwrapIpcOr({ ok: false, error: 'nope' }, 0)).toBe(0);
    });

    it('does not throw on !ok', () => {
      expect(() => unwrapIpcOr({ ok: false, error: 'nope' }, [])).not.toThrow();
    });

    it('accepts distinct fallback value types that match T', () => {
      const fallback: readonly string[] = [];
      const out = unwrapIpcOr<readonly string[]>(
        { ok: false, error: 'x' },
        fallback,
      );
      expect(out).toBe(fallback);
    });
  });
});
