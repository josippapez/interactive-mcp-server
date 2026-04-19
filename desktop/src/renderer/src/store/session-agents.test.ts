import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import {
  sessionAgentsAtom,
  getSessionAgent,
  setSessionAgentAtom,
  clearSessionAgentAtom,
} from './session-agents';

describe('sessionAgentsAtom', () => {
  it('defaults to an empty map', () => {
    const store = createStore();
    expect(store.get(sessionAgentsAtom).size).toBe(0);
  });

  it('records the agent for a connectionId via setSessionAgentAtom', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'plan',
    });
    expect(store.get(sessionAgentsAtom).get('conn-1')).toBe('plan');
  });

  it('overwrites an existing agent for the same connectionId', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'plan',
    });
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'docs-maintainer',
    });
    expect(store.get(sessionAgentsAtom).get('conn-1')).toBe('docs-maintainer');
  });

  it('clears the agent for a connectionId when set to null', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'plan',
    });
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: null,
    });
    expect(store.get(sessionAgentsAtom).has('conn-1')).toBe(false);
  });

  it('clearSessionAgentAtom removes an entry for the given connectionId', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-A',
      agent: 'plan',
    });
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-B',
      agent: 'docs-maintainer',
    });
    store.set(clearSessionAgentAtom, 'conn-A');

    const map = store.get(sessionAgentsAtom);
    expect(map.has('conn-A')).toBe(false);
    expect(map.get('conn-B')).toBe('docs-maintainer');
  });

  it('clearSessionAgentAtom is a no-op when the connectionId is unknown', () => {
    const store = createStore();
    expect(() =>
      store.set(clearSessionAgentAtom, 'unknown-conn'),
    ).not.toThrow();
    expect(store.get(sessionAgentsAtom).size).toBe(0);
  });

  it('isolates selections per connectionId', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-A',
      agent: 'plan',
    });
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-B',
      agent: 'docs-maintainer',
    });

    expect(store.get(sessionAgentsAtom).get('conn-A')).toBe('plan');
    expect(store.get(sessionAgentsAtom).get('conn-B')).toBe('docs-maintainer');
  });
});

describe('getSessionAgent', () => {
  it('returns the recorded agent for a connectionId', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'plan',
    });
    expect(getSessionAgent(store, 'conn-1')).toBe('plan');
  });

  it('returns null when the connectionId has no recorded agent', () => {
    const store = createStore();
    expect(getSessionAgent(store, 'missing')).toBeNull();
  });

  it('returns null when given a nullish connectionId', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      agent: 'plan',
    });
    expect(getSessionAgent(store, null)).toBeNull();
    expect(getSessionAgent(store, undefined)).toBeNull();
  });

  it('treats whitespace-only stored agents as null', () => {
    const store = createStore();
    store.set(setSessionAgentAtom, {
      connectionId: 'conn-1',
      // Should be normalised away by setter.
      agent: '   ',
    });
    expect(getSessionAgent(store, 'conn-1')).toBeNull();
  });
});
