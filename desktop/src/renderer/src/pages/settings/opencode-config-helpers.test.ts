import { describe, it, expect } from 'vitest';
import {
  safeParseJson,
  getStringField,
  mergeCommonFields,
  hasManagedInteractiveDesktopKey,
  stringifyConfigPretty,
} from './opencode-config-helpers';

describe('safeParseJson', () => {
  it('returns ok for valid JSON', () => {
    const result = safeParseJson('{"a": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it('returns error for invalid JSON', () => {
    const result = safeParseJson('{not valid}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-object root', () => {
    const result = safeParseJson('"hello"');
    expect(result.ok).toBe(false);
  });

  it('rejects arrays at root', () => {
    const result = safeParseJson('[1,2,3]');
    expect(result.ok).toBe(false);
  });

  it('accepts empty object', () => {
    const result = safeParseJson('{}');
    expect(result.ok).toBe(true);
  });
});

describe('getStringField', () => {
  it('returns the string value when present', () => {
    expect(getStringField({ model: 'claude' }, 'model')).toBe('claude');
  });

  it('returns empty string when missing', () => {
    expect(getStringField({}, 'model')).toBe('');
  });

  it('returns empty string when value is not a string', () => {
    expect(getStringField({ model: 42 }, 'model')).toBe('');
    expect(getStringField({ model: null }, 'model')).toBe('');
    expect(getStringField({ model: { a: 1 } }, 'model')).toBe('');
  });
});

describe('mergeCommonFields', () => {
  it('adds non-empty fields to the config', () => {
    const result = mergeCommonFields(
      { existing: 'yes' },
      { model: 'claude', theme: '', provider: 'anthropic' },
    );
    expect(result).toEqual({
      existing: 'yes',
      model: 'claude',
      provider: 'anthropic',
    });
  });

  it('removes keys that are blank', () => {
    const result = mergeCommonFields(
      { model: 'old', theme: 'dark', other: 1 },
      { model: '', theme: 'light', provider: '' },
    );
    expect(result).toEqual({ theme: 'light', other: 1 });
  });

  it('trims whitespace', () => {
    const result = mergeCommonFields(
      {},
      { model: '  claude  ', theme: '', provider: '' },
    );
    expect(result).toEqual({ model: 'claude' });
  });
});

describe('hasManagedInteractiveDesktopKey', () => {
  it('returns true when mcp.interactive-desktop exists', () => {
    expect(
      hasManagedInteractiveDesktopKey({
        mcp: { 'interactive-desktop': { type: 'remote' } },
      }),
    ).toBe(true);
  });

  it('returns false when missing', () => {
    expect(hasManagedInteractiveDesktopKey({ mcp: {} })).toBe(false);
    expect(hasManagedInteractiveDesktopKey({})).toBe(false);
    expect(hasManagedInteractiveDesktopKey(null)).toBe(false);
  });

  it('returns false when mcp is not an object', () => {
    expect(hasManagedInteractiveDesktopKey({ mcp: 'str' })).toBe(false);
  });
});

describe('stringifyConfigPretty', () => {
  it('pretty-prints with 2-space indent', () => {
    expect(stringifyConfigPretty({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('handles null', () => {
    expect(stringifyConfigPretty(null)).toBe('{}');
  });
});
