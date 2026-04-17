/**
 * Tests for agents.ts — OpenCode custom agent discovery, parsing, and CRUD.
 *
 * Uses a tmpdir-per-test approach via dependency-injected directory helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  parseAgentFile,
  serializeAgent,
  listAgents,
  readAgent,
  writeAgent,
  deleteAgent,
  _setAgentDirsForTests,
  _resetAgentDirsForTests,
  type AgentDefinition,
} from './agents';

describe('agents', () => {
  let rootDir: string;
  let globalDir: string;
  let projectDir: string;
  let projectBase: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'imcp-agents-test-'));
    globalDir = join(rootDir, 'global', 'agent');
    projectBase = join(rootDir, 'project');
    projectDir = join(projectBase, '.opencode', 'agent');
    _setAgentDirsForTests({
      globalAgentDir: () => globalDir,
      projectAgentDir: (base: string) => join(base, '.opencode', 'agent'),
    });
  });

  afterEach(() => {
    _resetAgentDirsForTests();
    rmSync(rootDir, { recursive: true, force: true });
  });

  // ─── Parser ────────────────────────────────────────────────────────────────

  describe('parseAgentFile', () => {
    it('parses file with full frontmatter', () => {
      const raw = `---
description: Helpful docs maintainer
mode: subagent
model: anthropic/claude-sonnet-4
tools:
  write: false
  edit: true
---
Prompt body here.
`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter).toEqual({
        description: 'Helpful docs maintainer',
        mode: 'subagent',
        model: 'anthropic/claude-sonnet-4',
        tools: { write: false, edit: true },
      });
      expect(result.body).toBe('Prompt body here.\n');
    });

    it('returns empty frontmatter when delimiters are absent', () => {
      const raw = `Just a body, no frontmatter.\n`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('Just a body, no frontmatter.\n');
    });

    it('handles missing fields gracefully', () => {
      const raw = `---
description: Just this
---
body
`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter).toEqual({ description: 'Just this' });
      expect(result.body).toBe('body\n');
    });

    it('ignores empty lines and comments', () => {
      const raw = `---
# leading comment
description: ok

mode: primary
# trailing comment
---
body
`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter).toEqual({
        description: 'ok',
        mode: 'primary',
      });
      expect(result.body).toBe('body\n');
    });

    it('parses quoted strings', () => {
      const raw = `---
description: "with: colon"
mode: 'subagent'
---
body
`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter.description).toBe('with: colon');
      expect(result.frontmatter.mode).toBe('subagent');
    });

    it('parses booleans and numbers', () => {
      const raw = `---
temperature: 0.5
enabled: true
disabled: false
---
body
`;
      const result = parseAgentFile(raw);
      expect(result.frontmatter).toEqual({
        temperature: 0.5,
        enabled: true,
        disabled: false,
      });
    });

    it('throws on malformed frontmatter (unclosed delimiter)', () => {
      const raw = `---
description: no closing
body
`;
      expect(() => parseAgentFile(raw)).toThrow();
    });

    it('throws on deeper-than-one-level nesting', () => {
      const raw = `---
tools:
  nested:
    too: deep
---
body
`;
      expect(() => parseAgentFile(raw)).toThrow();
    });
  });

  // ─── Serializer ────────────────────────────────────────────────────────────

  describe('serializeAgent', () => {
    it('round-trips through parse', () => {
      const serialized = serializeAgent({
        description: 'desc',
        mode: 'subagent',
        tools: { write: false, edit: true },
        model: 'anthropic/claude-sonnet-4',
        body: 'Hello world.\n',
      });
      const { frontmatter, body } = parseAgentFile(serialized);
      expect(frontmatter).toEqual({
        description: 'desc',
        mode: 'subagent',
        tools: { write: false, edit: true },
        model: 'anthropic/claude-sonnet-4',
      });
      expect(body).toBe('Hello world.\n');
    });

    it('omits empty tools and undefined model', () => {
      const serialized = serializeAgent({
        description: 'desc',
        mode: 'subagent',
        tools: {},
        body: 'x',
      });
      expect(serialized).not.toContain('tools:');
      expect(serialized).not.toContain('model:');
    });

    it('alphabetizes top-level keys', () => {
      const serialized = serializeAgent({
        description: 'd',
        mode: 'subagent',
        tools: { z: true, a: false },
        model: 'm',
        body: 'b',
      });
      const top = serialized.indexOf('description:');
      const mo = serialized.indexOf('mode:');
      const model = serialized.indexOf('model:');
      const tools = serialized.indexOf('tools:');
      expect(top).toBeLessThan(mo);
      expect(mo).toBeLessThan(model);
      expect(model).toBeLessThan(tools);
      // Tools keys alphabetized
      const aIdx = serialized.indexOf('a: false');
      const zIdx = serialized.indexOf('z: true');
      expect(aIdx).toBeLessThan(zIdx);
    });
  });

  // ─── Discovery ─────────────────────────────────────────────────────────────

  describe('listAgents', () => {
    it('returns empty list when directories are missing', async () => {
      const result = await listAgents();
      expect(result).toEqual([]);
    });

    it('lists global agents sorted by name', async () => {
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'zeta.md'),
        '---\ndescription: z\n---\nbody z',
      );
      writeFileSync(
        join(globalDir, 'alpha.md'),
        '---\ndescription: a\n---\nbody a',
      );
      const result = await listAgents();
      expect(result.map((a) => a.name)).toEqual(['alpha', 'zeta']);
      expect(result[0].scope).toBe('global');
      expect(result[0].description).toBe('a');
    });

    it('merges project-scoped agents and marks overridden globals', async () => {
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'docs.md'),
        '---\ndescription: global docs\n---\nbody',
      );
      writeFileSync(
        join(globalDir, 'unique.md'),
        '---\ndescription: only global\n---\nbody',
      );
      writeFileSync(
        join(projectDir, 'docs.md'),
        '---\ndescription: project docs\n---\nbody',
      );
      const result = await listAgents(projectBase);
      const byKey = Object.fromEntries(
        result.map((a) => [`${a.scope}:${a.name}`, a]),
      );
      expect(byKey['project:docs']).toBeDefined();
      expect(byKey['project:docs'].description).toBe('project docs');
      expect(byKey['global:docs'].overridden).toBe(true);
      expect(byKey['global:unique'].overridden).toBeFalsy();
    });

    it('skips files with malformed frontmatter', async () => {
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'good.md'), '---\ndescription: ok\n---\nb');
      writeFileSync(
        join(globalDir, 'bad.md'),
        '---\ndescription: no close\nstill body',
      );
      const result = await listAgents();
      expect(result.map((a) => a.name)).toEqual(['good']);
    });

    it('applies parser defaults for missing fields', async () => {
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'bare.md'), 'Just a body, no fm.');
      const result = await listAgents();
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('');
      expect(result[0].mode).toBe('subagent');
      expect(result[0].tools).toEqual({});
      expect(result[0].model).toBeUndefined();
      expect(result[0].body).toBe('Just a body, no fm.');
    });
  });

  // ─── readAgent ─────────────────────────────────────────────────────────────

  describe('readAgent', () => {
    it('reads an agent by absolute path', async () => {
      mkdirSync(globalDir, { recursive: true });
      const fp = join(globalDir, 'x.md');
      writeFileSync(fp, '---\ndescription: xyz\n---\nbody');
      const agent = await readAgent(fp);
      expect(agent).not.toBeNull();
      expect(agent?.name).toBe('x');
      expect(agent?.description).toBe('xyz');
    });

    it('returns null for a missing file', async () => {
      const agent = await readAgent(join(globalDir, 'nope.md'));
      expect(agent).toBeNull();
    });
  });

  // ─── writeAgent ────────────────────────────────────────────────────────────

  describe('writeAgent', () => {
    it('writes a global agent and creates directory', async () => {
      const { filePath } = await writeAgent({
        scope: 'global',
        name: 'hello',
        description: 'hi',
        mode: 'subagent',
        tools: { write: true },
        body: 'body',
      });
      expect(filePath).toBe(join(globalDir, 'hello.md'));
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain('description: hi');
    });

    it('writes a project agent under <base>/.opencode/agent', async () => {
      const { filePath } = await writeAgent({
        scope: 'project',
        baseDirectory: projectBase,
        name: 'proj',
        description: 'p',
        mode: 'subagent',
        tools: {},
        body: 'b',
      });
      expect(filePath).toBe(join(projectDir, 'proj.md'));
      expect(existsSync(filePath)).toBe(true);
    });

    it('round-trips — write then list returns the same parsed fields', async () => {
      await writeAgent({
        scope: 'global',
        name: 'rt',
        description: 'desc',
        mode: 'primary',
        tools: { write: false, edit: true },
        model: 'anthropic/claude-sonnet-4',
        body: 'Body content.\n',
      });
      const list = await listAgents();
      const a = list.find((x) => x.name === 'rt');
      expect(a).toBeDefined();
      expect(a).toMatchObject<Partial<AgentDefinition>>({
        name: 'rt',
        description: 'desc',
        mode: 'primary',
        tools: { write: false, edit: true },
        model: 'anthropic/claude-sonnet-4',
        body: 'Body content.\n',
      });
    });

    it('rejects invalid names (path traversal, special chars)', async () => {
      await expect(
        writeAgent({
          scope: 'global',
          name: '../evil',
          description: '',
          mode: 'subagent',
          tools: {},
          body: '',
        }),
      ).rejects.toThrow();
      await expect(
        writeAgent({
          scope: 'global',
          name: 'has space',
          description: '',
          mode: 'subagent',
          tools: {},
          body: '',
        }),
      ).rejects.toThrow();
    });

    it('requires baseDirectory when scope=project', async () => {
      await expect(
        writeAgent({
          scope: 'project',
          name: 'x',
          description: '',
          mode: 'subagent',
          tools: {},
          body: '',
        }),
      ).rejects.toThrow();
    });
  });

  // ─── deleteAgent ───────────────────────────────────────────────────────────

  describe('deleteAgent', () => {
    it('deletes a file inside the global agent dir', async () => {
      mkdirSync(globalDir, { recursive: true });
      const fp = join(globalDir, 'del.md');
      writeFileSync(fp, '---\n---\n');
      await deleteAgent(fp);
      expect(existsSync(fp)).toBe(false);
    });

    it('rejects deletion outside the known agent directories', async () => {
      const outside = join(rootDir, 'outside.md');
      writeFileSync(outside, 'x');
      await expect(deleteAgent(outside)).rejects.toThrow();
      expect(existsSync(outside)).toBe(true);
    });

    it('rejects path traversal attempts', async () => {
      await expect(
        deleteAgent(join(globalDir, '..', '..', 'etc', 'passwd')),
      ).rejects.toThrow();
    });
  });
});
