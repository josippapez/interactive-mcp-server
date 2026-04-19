import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import {
  DEFAULT_STICK_TO_BOTTOM,
  channelStickToBottomAtom,
  getChannelStickToBottom,
  setChannelStickToBottomAtom,
  stickToBottomMapAtom,
} from './channel-preferences';

// Minimal localStorage shim for the node test environment.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemoryStorage })
    .localStorage;
});

describe('stickToBottomMapAtom', () => {
  it('defaults to an empty map', () => {
    const store = createStore();
    const map = store.get(stickToBottomMapAtom);
    expect(map.size).toBe(0);
  });

  it('returns DEFAULT_STICK_TO_BOTTOM=true for an unknown channel via getter helper', () => {
    const store = createStore();
    const value = getChannelStickToBottom(
      store.get(stickToBottomMapAtom),
      'unknown',
    );
    expect(value).toBe(DEFAULT_STICK_TO_BOTTOM);
    expect(value).toBe(true);
  });
});

describe('setChannelStickToBottomAtom', () => {
  it('sets a per-channel preference and reads it back', () => {
    const store = createStore();
    store.set(setChannelStickToBottomAtom, {
      channelId: 'c1',
      stickToBottom: false,
    });
    const map = store.get(stickToBottomMapAtom);
    expect(map.get('c1')).toBe(false);
    expect(getChannelStickToBottom(map, 'c1')).toBe(false);
  });

  it('does not affect other channels', () => {
    const store = createStore();
    store.set(setChannelStickToBottomAtom, {
      channelId: 'c1',
      stickToBottom: false,
    });
    const map = store.get(stickToBottomMapAtom);
    // c2 was never set — falls back to the default.
    expect(getChannelStickToBottom(map, 'c2')).toBe(DEFAULT_STICK_TO_BOTTOM);
  });

  it('overwrites an existing preference', () => {
    const store = createStore();
    store.set(setChannelStickToBottomAtom, {
      channelId: 'c1',
      stickToBottom: false,
    });
    store.set(setChannelStickToBottomAtom, {
      channelId: 'c1',
      stickToBottom: true,
    });
    const map = store.get(stickToBottomMapAtom);
    expect(map.get('c1')).toBe(true);
  });
});

describe('channelStickToBottomAtom factory', () => {
  it('returns DEFAULT_STICK_TO_BOTTOM=true when channelId is null', () => {
    const store = createStore();
    const derived = channelStickToBottomAtom(null);
    expect(store.get(derived)).toBe(DEFAULT_STICK_TO_BOTTOM);
  });

  it('reflects a written preference for the given channelId', () => {
    const store = createStore();
    store.set(setChannelStickToBottomAtom, {
      channelId: 'c-9',
      stickToBottom: false,
    });
    const derived = channelStickToBottomAtom('c-9');
    expect(store.get(derived)).toBe(false);
  });

  it('falls back to the default for an unknown channelId', () => {
    const store = createStore();
    const derived = channelStickToBottomAtom('never-set');
    expect(store.get(derived)).toBe(DEFAULT_STICK_TO_BOTTOM);
  });
});
