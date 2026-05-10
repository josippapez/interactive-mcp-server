import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOpenCodeUrlBridgeHandler } from './url-bridge-handler';
import { __resetForTests, getOpenCodeUrl } from './url-subject';

type EventHandler = (payload: unknown) => void;

interface FakeBridge {
  on: (topic: string, cb: EventHandler) => () => void;
  emit: (topic: string, payload: unknown) => void;
  handlers: Map<string, Set<EventHandler>>;
}

function makeFakeBridge(): FakeBridge {
  const handlers = new Map<string, Set<EventHandler>>();
  return {
    handlers,
    on(topic, cb) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    emit(topic, payload) {
      const set = handlers.get(topic);
      if (!set) return;
      for (const cb of [...set]) cb(payload);
    },
  };
}

describe('url-bridge-handler', () => {
  beforeEach(() => {
    __resetForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('registers an unsubscribe function on the bridge', () => {
    const bridge = makeFakeBridge();
    const unsub = registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    expect(bridge.handlers.get('opencode.url.set')?.size).toBe(1);
    unsub();
    expect(bridge.handlers.get('opencode.url.set')?.size).toBe(0);
  });

  it('round-trips a string URL into the subject', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', { url: 'http://x' });
    expect(getOpenCodeUrl()).toBe('http://x');
  });

  it('clears subject when url is null', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', { url: 'http://x' });
    expect(getOpenCodeUrl()).toBe('http://x');
    bridge.emit('opencode.url.set', { url: null });
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('drops malformed payload (not an object)', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', 'not-an-object');
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('drops null payload', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', null);
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('drops payload missing url field', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', {});
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('drops payload with non-string url', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', { url: 4096 });
    expect(getOpenCodeUrl()).toBeNull();
  });

  it('drops payload with empty-string url', () => {
    const bridge = makeFakeBridge();
    registerOpenCodeUrlBridgeHandler(
      bridge as unknown as Parameters<
        typeof registerOpenCodeUrlBridgeHandler
      >[0],
    );
    bridge.emit('opencode.url.set', { url: '' });
    expect(getOpenCodeUrl()).toBeNull();
  });
});
