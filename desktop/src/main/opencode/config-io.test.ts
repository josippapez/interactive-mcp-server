import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  mergePreservingManagedKeys,
  readProjectConfig,
  writeProjectConfig,
  readConfigFile,
  writeConfigFile,
} from './config-io';

describe('mergePreservingManagedKeys', () => {
  it('returns incoming verbatim when on-disk has no managed key', () => {
    const onDisk = { foo: 1 };
    const incoming = { bar: 2, mcp: { 'other-thing': { url: 'x' } } };
    const merged = mergePreservingManagedKeys(onDisk, incoming);
    expect(merged).toEqual(incoming);
  });

  it('preserves managed key when incoming has no mcp', () => {
    const managed = { type: 'remote', url: 'http://localhost:1234/mcp' };
    const onDisk = { mcp: { 'interactive-desktop': managed } };
    const incoming = { foo: 1 };
    const merged = mergePreservingManagedKeys(onDisk, incoming);
    expect(merged).toEqual({
      foo: 1,
      mcp: { 'interactive-desktop': managed },
    });
  });

  it('preserves managed key alongside other incoming mcp entries', () => {
    const managed = { type: 'remote', url: 'http://localhost:1234/mcp' };
    const onDisk = { mcp: { 'interactive-desktop': managed } };
    const incoming = {
      foo: 1,
      mcp: { 'project-tool': { type: 'local', command: ['npx', 'x'] } },
    };
    const merged = mergePreservingManagedKeys(onDisk, incoming) as {
      mcp: Record<string, unknown>;
    };
    expect(merged.mcp['interactive-desktop']).toEqual(managed);
    expect(merged.mcp['project-tool']).toEqual({
      type: 'local',
      command: ['npx', 'x'],
    });
  });

  it('overwrites incoming interactive-desktop with on-disk value (managed wins)', () => {
    const managed = { type: 'remote', url: 'http://localhost:1234/mcp' };
    const onDisk = { mcp: { 'interactive-desktop': managed } };
    const incoming = {
      mcp: { 'interactive-desktop': { type: 'remote', url: 'http://evil' } },
    };
    const merged = mergePreservingManagedKeys(onDisk, incoming) as {
      mcp: Record<string, unknown>;
    };
    expect(merged.mcp['interactive-desktop']).toEqual(managed);
  });

  it('is a pure function — does not mutate inputs', () => {
    const managed = { type: 'remote', url: 'http://localhost:1234/mcp' };
    const onDisk = { mcp: { 'interactive-desktop': managed } };
    const incoming = { foo: 1 };
    const onDiskCopy = JSON.parse(JSON.stringify(onDisk));
    const incomingCopy = JSON.parse(JSON.stringify(incoming));
    mergePreservingManagedKeys(onDisk, incoming);
    expect(onDisk).toEqual(onDiskCopy);
    expect(incoming).toEqual(incomingCopy);
  });
});

describe('readConfigFile / writeConfigFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-io-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns { exists: false, config: null } when file missing', () => {
    const p = join(dir, 'missing.json');
    const result = readConfigFile(p);
    expect(result.exists).toBe(false);
    expect(result.config).toBeNull();
    expect(result.filePath).toBe(p);
  });

  it('parses JSON with // line comments', () => {
    const p = join(dir, 'cfg.json');
    writeFileSync(
      p,
      '{\n  // a comment\n  "foo": 1 // trailing comment\n}',
      'utf-8',
    );
    const result = readConfigFile(p);
    expect(result.exists).toBe(true);
    expect(result.config).toEqual({ foo: 1 });
  });

  it('throws on malformed JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not: json }', 'utf-8');
    expect(() => readConfigFile(p)).toThrow();
  });

  it('creates parent directory on write if missing', () => {
    const p = join(dir, 'nested', 'sub', 'cfg.json');
    writeConfigFile(p, { foo: 1 });
    expect(existsSync(p)).toBe(true);
    const raw = readFileSync(p, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ foo: 1 });
  });

  it('round-trip preserves managed key through merge', () => {
    const p = join(dir, 'rt.json');
    const managed = { type: 'remote', url: 'http://localhost:9999/mcp' };
    writeFileSync(
      p,
      JSON.stringify({ mcp: { 'interactive-desktop': managed } }, null, 2),
      'utf-8',
    );

    const onDisk = readConfigFile(p).config ?? {};
    const incoming = { foo: 42 };
    const merged = mergePreservingManagedKeys(onDisk, incoming);
    writeConfigFile(p, merged);

    const roundTripped = readConfigFile(p).config as {
      foo: number;
      mcp: { 'interactive-desktop': unknown };
    };
    expect(roundTripped.foo).toBe(42);
    expect(roundTripped.mcp['interactive-desktop']).toEqual(managed);
  });
});

describe('readProjectConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-proj-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when baseDirectory is empty', () => {
    expect(() => readProjectConfig('')).toThrow();
  });

  it('throws when baseDirectory contains ..', () => {
    expect(() => readProjectConfig('/tmp/../etc')).toThrow();
  });

  it('returns exists:false when no project config present', () => {
    const result = readProjectConfig(dir);
    expect(result.exists).toBe(false);
    expect(result.config).toBeNull();
    // filePath should be the .jsonc path (preferred)
    expect(result.filePath).toBe(join(dir, '.opencode', 'opencode.jsonc'));
  });

  it('prefers opencode.jsonc when both exist', () => {
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    writeFileSync(
      join(dir, '.opencode', 'opencode.jsonc'),
      '{ "source": "jsonc" }',
      'utf-8',
    );
    writeFileSync(
      join(dir, '.opencode', 'opencode.json'),
      '{ "source": "json" }',
      'utf-8',
    );
    const result = readProjectConfig(dir);
    expect(result.exists).toBe(true);
    expect(result.config).toEqual({ source: 'jsonc' });
    expect(result.filePath.endsWith('opencode.jsonc')).toBe(true);
  });

  it('falls back to opencode.json when .jsonc missing', () => {
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    writeFileSync(
      join(dir, '.opencode', 'opencode.json'),
      '{ "source": "json" }',
      'utf-8',
    );
    const result = readProjectConfig(dir);
    expect(result.exists).toBe(true);
    expect(result.config).toEqual({ source: 'json' });
    expect(result.filePath.endsWith('opencode.json')).toBe(true);
  });
});

describe('writeProjectConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-pw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when baseDirectory is empty', () => {
    expect(() => writeProjectConfig('', { foo: 1 })).toThrow();
  });

  it('throws when baseDirectory contains ..', () => {
    expect(() => writeProjectConfig('/tmp/../etc', { foo: 1 })).toThrow();
  });

  it('creates .opencode dir and writes to opencode.jsonc', () => {
    const result = writeProjectConfig(dir, { foo: 1 });
    expect(result.filePath).toBe(join(dir, '.opencode', 'opencode.jsonc'));
    expect(existsSync(result.filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(result.filePath, 'utf-8'));
    expect(parsed).toEqual({ foo: 1 });
  });

  it('preserves existing managed key on write', () => {
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    const managed = { type: 'remote', url: 'http://localhost:9999/mcp' };
    writeFileSync(
      join(dir, '.opencode', 'opencode.jsonc'),
      JSON.stringify({ mcp: { 'interactive-desktop': managed } }, null, 2),
      'utf-8',
    );

    writeProjectConfig(dir, { foo: 99 });

    const parsed = JSON.parse(
      readFileSync(join(dir, '.opencode', 'opencode.jsonc'), 'utf-8'),
    );
    expect(parsed.foo).toBe(99);
    expect(parsed.mcp['interactive-desktop']).toEqual(managed);
  });
});
