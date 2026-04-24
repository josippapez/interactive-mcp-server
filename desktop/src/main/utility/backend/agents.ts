/**
 * agents.ts — OpenCode custom agent discovery, parsing, and CRUD.
 *
 * Agent markdown files live in two locations:
 *   - Global: ~/.config/opencode/agent/*.md
 *   - Project: <baseDirectory>/.opencode/agent/*.md
 *
 * File format:
 *   ---
 *   description: ...
 *   mode: subagent | primary
 *   model: provider/model
 *   tools:
 *     write: false
 *     edit: true
 *   ---
 *   Free-form markdown body.
 *
 * Frontmatter is optional; missing fields get sensible defaults.
 */

import { join, resolve, sep } from 'path';
import {
  promises as fsp,
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
} from 'fs';
import {
  getGlobalAgentDir,
  getProjectAgentDir,
} from '../../utils/opencode-paths';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentDefinition {
  /** Filename without `.md` extension, e.g. "docs-maintainer" */
  name: string;
  /** Absolute path to the .md file */
  filePath: string;
  /** 'global' = ~/.config/opencode/agent/; 'project' = <baseDir>/.opencode/agent/ */
  scope: 'global' | 'project';
  /** Set only for scope='project' */
  baseDirectory?: string;
  description: string;
  mode: 'subagent' | 'primary' | string;
  tools: Record<string, boolean>;
  model?: string;
  /** Markdown body below the frontmatter */
  body: string;
  /** Raw file contents (unchanged), for round-tripping */
  rawContents: string;
  /** True if a project-scoped agent with the same name shadows this one */
  overridden?: boolean;
}

export interface WriteAgentParams {
  scope: 'global' | 'project';
  baseDirectory?: string;
  name: string;
  description: string;
  mode: string;
  tools: Record<string, boolean>;
  model?: string;
  body: string;
}

interface ParsedAgentFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

// ─── Directory helpers (dependency-injectable for tests) ────────────────────

interface AgentDirs {
  globalAgentDir: () => string;
  projectAgentDir: (baseDirectory: string) => string;
}

const defaultDirs: AgentDirs = {
  globalAgentDir: () => getGlobalAgentDir(),
  projectAgentDir: (baseDirectory: string) => getProjectAgentDir(baseDirectory),
};

let activeDirs: AgentDirs = defaultDirs;

export function _setAgentDirsForTests(dirs: AgentDirs): void {
  activeDirs = dirs;
}

export function _resetAgentDirsForTests(): void {
  activeDirs = defaultDirs;
}

export function globalAgentDir(): string {
  return activeDirs.globalAgentDir();
}

export function projectAgentDir(baseDirectory: string): string {
  return activeDirs.projectAgentDir(baseDirectory);
}

// ─── Name validation ────────────────────────────────────────────────────────

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidName(name: string): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid agent name "${name}" — must match [a-zA-Z0-9_-]+`);
  }
}

// ─── Frontmatter parser ─────────────────────────────────────────────────────

/**
 * Parse an agent markdown file into {frontmatter, body}.
 *
 * Frontmatter is OPTIONAL. If the file does not start with `---`, the whole
 * file is treated as the body and the frontmatter is empty.
 *
 * Supported YAML subset:
 *   - `key: value` (string, boolean, number)
 *   - Two-space-indented nested maps one level deep (e.g. `tools:` block)
 *   - Quoted strings ("..." or '...')
 *   - Empty lines and `#` comments ignored
 * Anything more complex (deeper nesting, arrays, anchors) throws.
 */
export function parseAgentFile(raw: string): ParsedAgentFile {
  // No frontmatter?
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: {}, body: raw };
  }

  // Locate the closing `---`.
  const lines = raw.split(/\r?\n/);
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    throw new Error('Malformed frontmatter: missing closing `---` delimiter');
  }

  const fmLines = lines.slice(1, closingIdx);
  const bodyLines = lines.slice(closingIdx + 1);
  const body = bodyLines.join('\n');

  const frontmatter = parseFrontmatterLines(fmLines);
  return { frontmatter, body };
}

function parseFrontmatterLines(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines and comments.
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    if (line.startsWith('  ')) {
      throw new Error(`Unexpected indented line at top level: "${line}"`);
    }
    if (line.startsWith(' ')) {
      throw new Error(`Unexpected single-space indent: "${line}"`);
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`Cannot parse frontmatter line: "${line}"`);
    }
    const key = match[1];
    const rawValue = match[2];

    if (rawValue === '') {
      // Expect an indented block (nested map).
      const nested: Record<string, boolean | string | number> = {};
      i++;
      while (i < lines.length) {
        const nested_line = lines[i];
        if (nested_line.trim() === '' || nested_line.trim().startsWith('#')) {
          i++;
          continue;
        }
        if (!nested_line.startsWith('  ')) break;
        if (nested_line.startsWith('   ') && !nested_line.startsWith('    ')) {
          // 3 spaces but not 4 — odd indent
          throw new Error(
            `Invalid nested indent (expected 2 spaces): "${nested_line}"`,
          );
        }
        if (nested_line.startsWith('    ')) {
          throw new Error(
            `Nested map deeper than one level is not supported: "${nested_line}"`,
          );
        }
        const inner = nested_line.slice(2);
        if (inner.startsWith(' ')) {
          throw new Error(
            `Invalid nested indent (mixed spaces): "${nested_line}"`,
          );
        }
        const nmatch = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(inner);
        if (!nmatch) {
          throw new Error(`Cannot parse nested line: "${nested_line}"`);
        }
        const nkey = nmatch[1];
        const nval = nmatch[2];
        if (nval === '') {
          throw new Error(
            `Nested map deeper than one level is not supported at "${nkey}"`,
          );
        }
        nested[nkey] = parseScalar(nval);
        i++;
      }
      result[key] = nested;
      continue;
    }

    result[key] = parseScalar(rawValue);
    i++;
  }
  return result;
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  // Quoted
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  return trimmed;
}

// ─── Serializer ─────────────────────────────────────────────────────────────

interface SerializeInput {
  description: string;
  mode: string;
  tools: Record<string, boolean>;
  model?: string;
  body: string;
}

export function serializeAgent(input: SerializeInput): string {
  const keys: string[] = [];
  const values: Record<string, string> = {};

  values.description = formatScalar(input.description);
  keys.push('description');

  values.mode = formatScalar(input.mode);
  keys.push('mode');

  if (input.model !== undefined) {
    values.model = formatScalar(input.model);
    keys.push('model');
  }

  const toolKeys = Object.keys(input.tools).sort();
  let toolsBlock: string | null = null;
  if (toolKeys.length > 0) {
    toolsBlock = toolKeys.map((k) => `  ${k}: ${input.tools[k]}`).join('\n');
    keys.push('tools');
  }

  const alphabetized = keys.slice().sort();
  const lines: string[] = ['---'];
  for (const k of alphabetized) {
    if (k === 'tools' && toolsBlock !== null) {
      lines.push('tools:');
      lines.push(toolsBlock);
    } else {
      lines.push(`${k}: ${values[k]}`);
    }
  }
  lines.push('---');
  lines.push('');

  return lines.join('\n') + input.body;
}

function formatScalar(value: string): string {
  // Quote if the value contains special chars that would confuse the parser.
  if (value === '' || /[:#'"]/.test(value) || /^\s|\s$/.test(value)) {
    // Use double quotes, escape inner doublequotes.
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

// ─── Core API ───────────────────────────────────────────────────────────────

function readAgentFromDisk(
  filePath: string,
  scope: 'global' | 'project',
  baseDirectory?: string,
): AgentDefinition | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const { frontmatter, body } = parseAgentFile(raw);
  const name = filePath.split(sep).pop()!.replace(/\.md$/, '');

  const rawTools = frontmatter.tools;
  const tools: Record<string, boolean> = {};
  if (rawTools && typeof rawTools === 'object' && !Array.isArray(rawTools)) {
    for (const [k, v] of Object.entries(rawTools as Record<string, unknown>)) {
      if (typeof v === 'boolean') tools[k] = v;
    }
  }

  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const mode =
    typeof frontmatter.mode === 'string' ? frontmatter.mode : 'subagent';
  const model =
    typeof frontmatter.model === 'string' ? frontmatter.model : undefined;

  const agent: AgentDefinition = {
    name,
    filePath,
    scope,
    description,
    mode,
    tools,
    body,
    rawContents: raw,
  };
  if (model !== undefined) agent.model = model;
  if (scope === 'project' && baseDirectory) agent.baseDirectory = baseDirectory;
  return agent;
}

function scanDir(
  dir: string,
  scope: 'global' | 'project',
  baseDirectory?: string,
): AgentDefinition[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const agents: AgentDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue;
    const full = join(dir, entry);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    try {
      const agent = readAgentFromDisk(full, scope, baseDirectory);
      if (agent) agents.push(agent);
    } catch (err) {
      // Malformed file — log and skip.

      console.warn(
        `[agents] skipping malformed agent file ${full}:`,
        (err as Error).message,
      );
    }
  }
  return agents;
}

export async function listAgents(
  baseDirectory?: string,
): Promise<AgentDefinition[]> {
  const globals = scanDir(globalAgentDir(), 'global');
  const projects = baseDirectory
    ? scanDir(projectAgentDir(baseDirectory), 'project', baseDirectory)
    : [];

  const projectNames = new Set(projects.map((a) => a.name));
  for (const g of globals) {
    if (projectNames.has(g.name)) g.overridden = true;
  }
  // Project-first order, then globals; both already sorted by name.
  return [...projects, ...globals];
}

export async function readAgent(
  filePath: string,
): Promise<AgentDefinition | null> {
  if (!existsSync(filePath)) return null;
  const abs = resolve(filePath);
  const global = resolve(globalAgentDir());
  if (abs.startsWith(global + sep) || abs === global) {
    return readAgentFromDisk(abs, 'global');
  }
  // Project scope — base directory is whatever parent contains .opencode/agent
  const projSegment = `${sep}.opencode${sep}agent${sep}`;
  const idx = abs.indexOf(projSegment);
  if (idx !== -1) {
    const base = abs.slice(0, idx);
    return readAgentFromDisk(abs, 'project', base);
  }
  // Unknown location — still read it but mark as global for safety
  try {
    return readAgentFromDisk(abs, 'global');
  } catch {
    return null;
  }
}

export async function writeAgent(
  params: WriteAgentParams,
): Promise<{ filePath: string }> {
  assertValidName(params.name);

  let dir: string;
  if (params.scope === 'project') {
    if (!params.baseDirectory) {
      throw new Error('baseDirectory is required when scope=project');
    }
    dir = projectAgentDir(params.baseDirectory);
  } else {
    dir = globalAgentDir();
  }

  await fsp.mkdir(dir, { recursive: true });

  const filePath = join(dir, `${params.name}.md`);
  const serialized = serializeAgent({
    description: params.description,
    mode: params.mode,
    tools: params.tools,
    model: params.model,
    body: params.body,
  });
  await fsp.writeFile(filePath, serialized, 'utf8');
  return { filePath };
}

export async function deleteAgent(filePath: string): Promise<void> {
  const abs = resolve(filePath);
  const global = resolve(globalAgentDir());
  const isInGlobal = abs.startsWith(global + sep);

  const projSegment = `${sep}.opencode${sep}agent${sep}`;
  const isInProject = abs.includes(projSegment);

  if (!isInGlobal && !isInProject) {
    throw new Error(
      `Refusing to delete file outside known agent directories: ${abs}`,
    );
  }
  // Final traversal guard
  if (abs.split(sep).includes('..')) {
    throw new Error(`Path contains traversal segments: ${abs}`);
  }
  if (!abs.endsWith('.md')) {
    throw new Error(`Refusing to delete non-.md file: ${abs}`);
  }
  await fsp.rm(abs, { force: false });
}
