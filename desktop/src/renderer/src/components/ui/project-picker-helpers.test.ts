import { describe, it, expect } from 'vitest';
import {
  toProjectOptions,
  resolveSelectValue,
  OTHER_OPTION_VALUE,
  type PinnedProject,
} from './project-picker-helpers';

describe('toProjectOptions', () => {
  it('returns label from name when present', () => {
    const pinned: PinnedProject[] = [
      { path: '/a/b', name: 'My Project', createdAt: 't' },
    ];
    expect(toProjectOptions(pinned)).toEqual([
      { path: '/a/b', label: 'My Project' },
    ]);
  });

  it('falls back to trailing path segment when name is empty', () => {
    const pinned: PinnedProject[] = [
      { path: '/users/me/Desktop/foo', name: '', createdAt: 't' },
      { path: '/users/me/bar/', name: '   ', createdAt: 't' },
    ];
    expect(toProjectOptions(pinned)).toEqual([
      { path: '/users/me/Desktop/foo', label: 'foo' },
      { path: '/users/me/bar/', label: 'bar' },
    ]);
  });

  it('deduplicates by path, preferring first occurrence', () => {
    const pinned: PinnedProject[] = [
      { path: '/a', name: 'First', createdAt: '1' },
      { path: '/a', name: 'Second', createdAt: '2' },
      { path: '/b', name: 'B', createdAt: '3' },
    ];
    expect(toProjectOptions(pinned)).toEqual([
      { path: '/a', label: 'First' },
      { path: '/b', label: 'B' },
    ]);
  });

  it('drops entries with empty or whitespace-only paths', () => {
    const pinned: PinnedProject[] = [
      { path: '', name: 'x', createdAt: 't' },
      { path: '   ', name: 'y', createdAt: 't' },
      { path: '/ok', name: 'ok', createdAt: 't' },
    ];
    expect(toProjectOptions(pinned)).toEqual([{ path: '/ok', label: 'ok' }]);
  });
});

describe('resolveSelectValue', () => {
  const options = [
    { path: '/a', label: 'A' },
    { path: '/b', label: 'B' },
  ];

  it('returns empty string for empty value', () => {
    expect(resolveSelectValue('', options)).toBe('');
  });

  it('returns the path when it matches a pinned option', () => {
    expect(resolveSelectValue('/a', options)).toBe('/a');
  });

  it('returns the OTHER sentinel when value is not in options', () => {
    expect(resolveSelectValue('/not/pinned', options)).toBe(OTHER_OPTION_VALUE);
  });

  it('treats empty options list as always "other" for non-empty values', () => {
    expect(resolveSelectValue('/x', [])).toBe(OTHER_OPTION_VALUE);
  });
});
