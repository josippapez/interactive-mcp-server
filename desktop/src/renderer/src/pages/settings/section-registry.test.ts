import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SECTIONS,
  getSectionById,
  getSectionIds,
} from './section-registry';
import type { SettingsSection } from './settings-types';

describe('section-registry', () => {
  it('registers all expected sections in the documented order', () => {
    expect(getSectionIds()).toEqual([
      'server',
      'provider',
      'sessions',
      'documentation',
      'permissions',
      'preferences',
      'agents',
      'opencode-config',
      'advanced',
    ]);
  });

  it('every entry has id, label, icon, and a component', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.id).toBeTypeOf('string');
      expect(section.label).toBeTypeOf('string');
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.icon).toBeTypeOf('string');
      expect(section.icon.length).toBeGreaterThan(0);
      expect(typeof section.component).toBe('function');
    }
  });

  it('ids are unique', () => {
    const ids = getSectionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getSectionById resolves every registered id', () => {
    for (const id of getSectionIds()) {
      const entry = getSectionById(id);
      expect(entry).toBeDefined();
      expect(entry?.id).toBe(id);
    }
  });

  it('getSectionById returns undefined for an unknown id', () => {
    // Cast through unknown: exercising runtime behavior for an invalid id.
    const missing = getSectionById(
      'not-a-section' as unknown as SettingsSection,
    );
    expect(missing).toBeUndefined();
  });

  it('registry ids form a subset of the SettingsSection union (type-level assertion)', () => {
    // This assignment only compiles if every registry id is assignable to
    // `SettingsSection`. The runtime expectation is redundant but keeps the
    // test framework happy.
    const ids: SettingsSection[] = getSectionIds();
    expect(ids.length).toBe(SETTINGS_SECTIONS.length);
  });
});
