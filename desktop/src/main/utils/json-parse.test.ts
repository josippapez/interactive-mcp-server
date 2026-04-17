import { describe, it, expect } from 'vitest';
import { stripJsonComments, parseJsonc } from './json-parse';

describe('stripJsonComments', () => {
  it('returns plain JSON unchanged', () => {
    const raw = '{"a": 1, "b": "two"}';
    expect(stripJsonComments(raw)).toBe(raw);
  });

  it('strips line comments at end of line', () => {
    const raw = '{\n  "a": 1 // trailing\n}';
    const stripped = stripJsonComments(raw);
    expect(stripped).toBe('{\n  "a": 1 \n}');
    expect(JSON.parse(stripped)).toEqual({ a: 1 });
  });

  it('strips full-line comments', () => {
    const raw = '{\n  // note\n  "a": 1\n}';
    expect(JSON.parse(stripJsonComments(raw))).toEqual({ a: 1 });
  });

  it('strips block comments', () => {
    const raw = '{\n  /* block\n     comment */ "a": 1\n}';
    expect(JSON.parse(stripJsonComments(raw))).toEqual({ a: 1 });
  });

  it('does not strip `//` inside strings', () => {
    const raw = '{"url": "http://example.com"}';
    expect(stripJsonComments(raw)).toBe(raw);
    expect(JSON.parse(stripJsonComments(raw))).toEqual({
      url: 'http://example.com',
    });
  });

  it('respects escaped quotes inside strings', () => {
    const raw = '{"s": "he said \\"hi\\" // not a comment"}';
    expect(JSON.parse(stripJsonComments(raw))).toEqual({
      s: 'he said "hi" // not a comment',
    });
  });

  it('handles mixed comments and strings', () => {
    const raw = [
      '{',
      '  // top',
      '  "mcp": {',
      '    "url": "http://x/y", // endpoint',
      '    /* flag */ "on": true',
      '  }',
      '}',
    ].join('\n');
    expect(JSON.parse(stripJsonComments(raw))).toEqual({
      mcp: { url: 'http://x/y', on: true },
    });
  });
});

describe('parseJsonc', () => {
  it('parses plain JSON', () => {
    expect(parseJsonc<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSONC with line and block comments', () => {
    const raw = '{\n  // c\n  "a": 1 /* b */\n}';
    expect(parseJsonc<{ a: number }>(raw)).toEqual({ a: 1 });
  });

  it('throws an Error with a cause on bad input', () => {
    let caught: unknown;
    try {
      parseJsonc('{not json}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const e = caught as Error;
    expect(e.message).toMatch(/Failed to parse JSONC/);
    expect(e.cause).toBeDefined();
  });
});
