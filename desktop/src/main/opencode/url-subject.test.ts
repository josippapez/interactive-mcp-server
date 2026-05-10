import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  getOpenCodeUrl,
  setOpenCodeUrl,
  subscribeOpenCodeUrl,
  waitForOpenCodeUrl,
} from './url-subject';

describe('url-subject', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('getOpenCodeUrl() returns null initially', () => {
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('setOpenCodeUrl then getOpenCodeUrl returns the value', () => {
    setOpenCodeUrl('http://x');
    expect(getOpenCodeUrl()).toBe('http://x');
  });

  it('subscribeOpenCodeUrl fires on next set', () => {
    const cb = vi.fn();
    subscribeOpenCodeUrl(cb);
    setOpenCodeUrl('http://x');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('http://x');
  });

  it('does not fire on initial subscribe (before any set)', () => {
    const cb = vi.fn();
    subscribeOpenCodeUrl(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('setting same value twice does not double-fire subscribers', () => {
    const cb = vi.fn();
    subscribeOpenCodeUrl(cb);
    setOpenCodeUrl('http://x');
    setOpenCodeUrl('http://x');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further notifications', () => {
    const cb = vi.fn();
    const unsub = subscribeOpenCodeUrl(cb);
    setOpenCodeUrl('http://x');
    unsub();
    setOpenCodeUrl('http://y');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('http://x');
  });

  it('multiple subscribers all fire', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeOpenCodeUrl(a);
    subscribeOpenCodeUrl(b);
    setOpenCodeUrl('http://x');
    expect(a).toHaveBeenCalledWith('http://x');
    expect(b).toHaveBeenCalledWith('http://x');
  });

  it('null transitions are observable', () => {
    const cb = vi.fn();
    subscribeOpenCodeUrl(cb);
    setOpenCodeUrl('http://x');
    setOpenCodeUrl(null);
    expect(cb).toHaveBeenNthCalledWith(1, 'http://x');
    expect(cb).toHaveBeenNthCalledWith(2, null);
  });

  it('subscriber that throws does not break others', () => {
    const a = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    subscribeOpenCodeUrl(a);
    subscribeOpenCodeUrl(b);
    setOpenCodeUrl('http://x');
    expect(b).toHaveBeenCalledWith('http://x');
  });

  it('waitForOpenCodeUrl resolves immediately when value is set', async () => {
    setOpenCodeUrl('http://x');
    await expect(waitForOpenCodeUrl(50)).resolves.toBe('http://x');
  });

  it('waitForOpenCodeUrl waits and resolves on next set', async () => {
    const p = waitForOpenCodeUrl(1_000);
    setTimeout(() => setOpenCodeUrl('http://y'), 10);
    await expect(p).resolves.toBe('http://y');
  });

  it('waitForOpenCodeUrl rejects on timeout if no value arrives', async () => {
    await expect(waitForOpenCodeUrl(20)).rejects.toThrow(/timed out/);
  });

  it('waitForOpenCodeUrl ignores null transitions while waiting', async () => {
    const p = waitForOpenCodeUrl(200);
    setOpenCodeUrl(null);
    setTimeout(() => setOpenCodeUrl('http://z'), 10);
    await expect(p).resolves.toBe('http://z');
  });
});
