import { describe, expect, it } from 'vitest';

import { isNushell, mergeShellEnv, parseShellEnv } from './shell-env';

describe('shell-env', () => {
  describe('parseShellEnv', () => {
    it('parses null-delimited key=value pairs', () => {
      const env = parseShellEnv(
        Buffer.from('PATH=/usr/bin:/bin\0FOO=bar=baz\0\0'),
      );

      expect(env.PATH).toBe('/usr/bin:/bin');
      expect(env.FOO).toBe('bar=baz');
    });

    it('handles values containing equals signs', () => {
      const env = parseShellEnv(
        Buffer.from('API_KEY=abc=123=xyz\0OTHER=value\0'),
      );

      expect(env.API_KEY).toBe('abc=123=xyz');
      expect(env.OTHER).toBe('value');
    });

    it('ignores invalid entries without equals sign', () => {
      const env = parseShellEnv(Buffer.from('INVALID\0=empty\0OK=1\0'));

      expect(Object.keys(env)).toHaveLength(1);
      expect(env.OK).toBe('1');
    });

    it('handles empty buffer', () => {
      const env = parseShellEnv(Buffer.from(''));

      expect(Object.keys(env)).toHaveLength(0);
    });

    it('handles buffer with only null bytes', () => {
      const env = parseShellEnv(Buffer.from('\0\0\0'));

      expect(Object.keys(env)).toHaveLength(0);
    });
  });

  describe('isNushell', () => {
    it('detects nu by name', () => {
      expect(isNushell('nu')).toBe(true);
    });

    it('detects nu in full path', () => {
      expect(isNushell('/opt/homebrew/bin/nu')).toBe(true);
      expect(isNushell('/usr/local/bin/nu')).toBe(true);
    });

    it('detects nu.exe on Windows', () => {
      expect(isNushell('nu.exe')).toBe(true);
      expect(isNushell('C:\\Program Files\\nu.exe')).toBe(true);
    });

    it('returns false for other shells', () => {
      expect(isNushell('/bin/zsh')).toBe(false);
      expect(isNushell('/bin/bash')).toBe(false);
      expect(isNushell('/bin/sh')).toBe(false);
      expect(isNushell('/usr/bin/fish')).toBe(false);
    });
  });

  describe('mergeShellEnv', () => {
    it('merges shell env with overrides', () => {
      const env = mergeShellEnv(
        {
          PATH: '/shell/path',
          HOME: '/tmp/home',
        },
        {
          PATH: '/desktop/path',
          OPENCODE_CLIENT: 'desktop',
        },
      );

      expect(env.PATH).toBe('/desktop/path');
      expect(env.HOME).toBe('/tmp/home');
      expect(env.OPENCODE_CLIENT).toBe('desktop');
    });

    it('handles null shell env', () => {
      const env = mergeShellEnv(null, {
        PATH: '/desktop/path',
        OPENCODE_CLIENT: 'desktop',
      });

      expect(env.PATH).toBe('/desktop/path');
      expect(env.OPENCODE_CLIENT).toBe('desktop');
    });

    it('handles empty override', () => {
      const env = mergeShellEnv(
        {
          PATH: '/shell/path',
          HOME: '/tmp/home',
        },
        {},
      );

      expect(env.PATH).toBe('/shell/path');
      expect(env.HOME).toBe('/tmp/home');
    });
  });
});
