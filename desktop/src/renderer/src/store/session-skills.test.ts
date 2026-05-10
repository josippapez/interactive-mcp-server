import { describe, expect, it } from 'vitest';

import {
  countActiveSkillsForSession,
  getActiveSkillsForSession,
  isEntryActiveForSession,
} from './session-skills';

describe('isEntryActiveForSession', () => {
  it('treats global entries as active unless muted', () => {
    expect(
      isEntryActiveForSession(
        { name: 'global-skill', scope: 'global' },
        { optedIn: new Set(), muted: new Set() },
      ),
    ).toBe(true);

    expect(
      isEntryActiveForSession(
        { name: 'global-skill', scope: 'global' },
        { optedIn: new Set(), muted: new Set(['global-skill']) },
      ),
    ).toBe(false);
  });

  it('treats session-scoped entries as active only when opted in', () => {
    expect(
      isEntryActiveForSession(
        { name: 'session-skill', scope: 'session-scoped' },
        { optedIn: new Set(), muted: new Set() },
      ),
    ).toBe(false);

    expect(
      isEntryActiveForSession(
        { name: 'session-skill', scope: 'session-scoped' },
        { optedIn: new Set(['session-skill']), muted: new Set() },
      ),
    ).toBe(true);
  });
});

describe('countActiveSkillsForSession', () => {
  it('counts only enabled skill entries active for a session', () => {
    const entries = [
      { name: 'global-skill', type: 'skill', scope: 'global', enabled: true },
      {
        name: 'muted-global-skill',
        type: 'skill',
        scope: 'global',
        enabled: true,
      },
      {
        name: 'opted-in-session-skill',
        type: 'skill',
        scope: 'session-scoped',
        enabled: true,
      },
      {
        name: 'inactive-session-skill',
        type: 'skill',
        scope: 'session-scoped',
        enabled: true,
      },
      {
        name: 'active-instruction',
        type: 'instruction',
        scope: 'global',
        enabled: true,
      },
      {
        name: 'disabled-skill',
        type: 'skill',
        scope: 'global',
        enabled: false,
      },
    ] as const;

    expect(
      countActiveSkillsForSession(entries, {
        optedIn: new Set(['opted-in-session-skill']),
        muted: new Set(['muted-global-skill']),
      }),
    ).toBe(2);
  });

  it('returns the active skill entries for display', () => {
    const entries = [
      { name: 'global-skill', type: 'skill', scope: 'global', enabled: true },
      { name: 'muted-skill', type: 'skill', scope: 'global', enabled: true },
      {
        name: 'enabled-instruction',
        type: 'instruction',
        scope: 'global',
        enabled: true,
      },
    ] as const;

    expect(
      getActiveSkillsForSession(entries, {
        optedIn: new Set(),
        muted: new Set(['muted-skill']),
      }).map((entry) => entry.name),
    ).toEqual(['global-skill']);
  });
});
