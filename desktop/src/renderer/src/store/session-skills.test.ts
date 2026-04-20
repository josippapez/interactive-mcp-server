import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isEntryActiveForSession,
  makeSessionSkillsKey,
  useInvalidateSessionSkills,
  useLoadSessionSkills,
  useSessionSkillsSelection,
  useToggleSessionMute,
  useToggleSessionOptIn,
} from './session-skills';

describe('makeSessionSkillsKey', () => {
  it('concatenates providerType and providerSessionId with a colon', () => {
    expect(makeSessionSkillsKey('opencode', 'ses_abc')).toBe(
      'opencode:ses_abc',
    );
  });

  it('produces distinct keys for different provider types', () => {
    expect(makeSessionSkillsKey('opencode', 'ses_x')).not.toBe(
      makeSessionSkillsKey('copilot', 'ses_x'),
    );
  });
});

describe('isEntryActiveForSession', () => {
  it('global entries are active when not muted', () => {
    const active = isEntryActiveForSession(
      { name: 'g1', scope: 'global' },
      { optedIn: new Set(), muted: new Set() },
    );
    expect(active).toBe(true);
  });

  it('global entries are inactive when muted', () => {
    const active = isEntryActiveForSession(
      { name: 'g1', scope: 'global' },
      { optedIn: new Set(), muted: new Set(['g1']) },
    );
    expect(active).toBe(false);
  });

  it('session-scoped entries are active only when opted in', () => {
    const active = isEntryActiveForSession(
      { name: 's1', scope: 'session-scoped' },
      { optedIn: new Set(['s1']), muted: new Set() },
    );
    expect(active).toBe(true);
  });

  it('session-scoped entries are inactive when not opted in', () => {
    const active = isEntryActiveForSession(
      { name: 's1', scope: 'session-scoped' },
      { optedIn: new Set(), muted: new Set() },
    );
    expect(active).toBe(false);
  });

  it('mute set does not affect session-scoped entries with the same name', () => {
    const active = isEntryActiveForSession(
      { name: 'x', scope: 'session-scoped' },
      { optedIn: new Set(['x']), muted: new Set(['x']) },
    );
    // Mute set only applies to globals; a session-scoped opt-in stays active.
    expect(active).toBe(true);
  });
});

describe('hook callback stability', () => {
  it('useLoadSessionSkills returns the same function reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useLoadSessionSkills());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useToggleSessionOptIn returns the same function reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useToggleSessionOptIn());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useToggleSessionMute returns the same function reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useToggleSessionMute());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useInvalidateSessionSkills returns the same function reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useInvalidateSessionSkills());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useSessionSkillsSelection returns a stable selection object when inputs are unchanged', () => {
    // If the factory atom is recreated every render, jotai's external-store
    // subscription fires a new "changed" snapshot each render and the
    // component re-renders forever. We bound the render count with a safety
    // counter so a broken implementation fails with a clear message instead
    // of hanging the test runner.
    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount += 1;
      if (renderCount > 20) {
        throw new Error(
          `useSessionSkillsSelection re-rendered ${renderCount} times — ` +
            'likely caused by a new atom being created each render.',
        );
      }
      return useSessionSkillsSelection('opencode', 'ses_abc');
    });
    const first = result.current;
    rerender();
    expect(Object.is(result.current, first)).toBe(true);
  });
});
