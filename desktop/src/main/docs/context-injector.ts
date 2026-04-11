/**
 * Repository documentation context injector.
 *
 * Orchestrates:
 * 1. Discovering documentation files in a repository.
 * 2. Building a manifest of doc paths + titles.
 * 3. Injecting the manifest into an OpenCode session via noReply.
 * 4. Providing hybrid keyword + semantic search for on-demand queries.
 */

import type { BrowserWindow } from 'electron';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from 'node:fs';
import { join, relative } from 'node:path';
import {
  buildFullCache,
  DOC_MAX_FILE_SIZE,
  extractTitle,
  findSemantic,
  isReady,
  SEMANTIC_THRESHOLD,
  SEMANTIC_WEIGHT,
  warmUp,
} from './indexer';
import { injectOpenCodeMessage } from '../opencode/injector';

// ── Configuration ───────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  '.git',
  '.nx',
  '.vscode',
  'coverage',
  'dist',
  'evidence',
  'evidence-tmp',
  'node_modules',
  'Pods',
  'tmp',
  'build',
  'out',
  'release',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  '.parcel-cache',
]);

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'between',
  'out',
  'off',
  'over',
  'under',
  'then',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'while',
  'that',
  'this',
  'it',
  'its',
]);

// ── Directory walking ───────────────────────────────────────────────────────

function walkDirectory(
  dirPath: string,
  visitor: (filePath: string) => void,
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkDirectory(fullPath, visitor);
      }
      continue;
    }
    if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

// ── Document discovery ──────────────────────────────────────────────────────

export interface DocFile {
  absPath: string;
  relPath: string;
}

/**
 * Discover all documentation files in a repository.
 *
 * Sources:
 * - docs/ directory: all .md/.mdx files
 * - Root README.md
 * - apps/*, libs/*, tools/*: README.md files
 * - .github/instructions/: all .md files
 * - .github/skills/: SKILL.md files
 * - .agents/skills/: SKILL.md files
 */
export function discoverDocs(baseDirectory: string): DocFile[] {
  const files: string[] = [];

  // docs/ directory
  const docsRoot = join(baseDirectory, 'docs');
  if (existsSync(docsRoot)) {
    walkDirectory(docsRoot, (filePath) => {
      if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
        files.push(filePath);
      }
    });
  }

  // Root README.md
  const rootReadme = join(baseDirectory, 'README.md');
  if (existsSync(rootReadme)) {
    files.push(rootReadme);
  }

  // README.md files in apps/, libs/, tools/
  for (const topDir of ['apps', 'libs', 'tools']) {
    const targetDir = join(baseDirectory, topDir);
    if (!existsSync(targetDir)) continue;
    walkDirectory(targetDir, (filePath) => {
      if (filePath.toLowerCase().endsWith('/readme.md')) {
        files.push(filePath);
      }
    });
  }

  // .github/instructions/ .md files
  const instructionsDir = join(baseDirectory, '.github', 'instructions');
  if (existsSync(instructionsDir)) {
    walkDirectory(instructionsDir, (filePath) => {
      if (filePath.endsWith('.md')) {
        files.push(filePath);
      }
    });
  }

  // .github/skills/ SKILL.md files
  const skillsDir = join(baseDirectory, '.github', 'skills');
  if (existsSync(skillsDir)) {
    walkDirectory(skillsDir, (filePath) => {
      if (filePath.toLowerCase().endsWith('/skill.md')) {
        files.push(filePath);
      }
    });
  }

  // .agents/skills/ SKILL.md files
  const agentSkillsDir = join(baseDirectory, '.agents', 'skills');
  if (existsSync(agentSkillsDir)) {
    walkDirectory(agentSkillsDir, (filePath) => {
      if (filePath.toLowerCase().endsWith('/skill.md')) {
        files.push(filePath);
      }
    });
  }

  // Deduplicate and convert to DocFile format
  const unique = Array.from(new Set(files));
  return unique.map((absPath) => ({
    absPath,
    relPath: relative(baseDirectory, absPath),
  }));
}

// ── Manifest building ───────────────────────────────────────────────────────

interface ManifestEntry {
  relPath: string;
  title: string | null;
}

function buildManifest(docFiles: DocFile[]): ManifestEntry[] {
  return docFiles.map(({ absPath, relPath }) => {
    let title: string | null = null;
    try {
      const content = readFileSync(absPath, 'utf8');
      title = extractTitle(content);
    } catch {
      // skip title extraction on read error
    }
    return { relPath, title };
  });
}

function formatManifest(
  entries: ManifestEntry[],
  baseDirectory: string,
): string {
  // Group by top-level directory
  const groups = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    const parts = entry.relPath.split('/');
    const group =
      parts.length > 1
        ? parts[0]
        : entry.relPath === 'README.md'
          ? 'Root'
          : parts[0];
    const groupKey = group.charAt(0).toUpperCase() + group.slice(1);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(entry);
  }

  const lines = [
    `<system-reminder>`,
    `Repository documentation index for ${baseDirectory}:`,
    ``,
  ];

  for (const [groupName, groupEntries] of groups) {
    lines.push(`${groupName}:`);
    for (const entry of groupEntries) {
      const titleSuffix = entry.title ? ` — ${entry.title}` : '';
      lines.push(`  - ${entry.relPath}${titleSuffix}`);
    }
    lines.push('');
  }

  lines.push('Use the Read tool to access any of these files when needed.');
  lines.push('Use the find_repo_docs tool to search docs by query.');
  lines.push('</system-reminder>');

  return lines.join('\n');
}

// ── Search (hybrid keyword + semantic) ──────────────────────────────────────

export interface DocSearchResult {
  path: string;
  score: number;
  lineNumber: number;
  snippet: string;
}

function tokenize(input: string): string[] {
  const raw = String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/g)
    .filter(Boolean);
  const filtered = raw.filter((t) => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : raw;
}

function countMatches(text: string, token: string, cap = 3): number {
  let idx = 0;
  let count = 0;
  while (count < cap) {
    idx = text.indexOf(token, idx);
    if (idx === -1) break;
    count += 1;
    idx += token.length || 1;
  }
  return count;
}

const DIR_TOKEN_MAP = [
  {
    dir: '/standards/',
    weight: 4,
    related: [
      'best',
      'practices',
      'practice',
      'standard',
      'standards',
      'convention',
      'rule',
      'policy',
      'guideline',
      'guidelines',
    ],
  },
  {
    dir: '/guides/',
    weight: 2,
    related: [
      'best',
      'practices',
      'practice',
      'guide',
      'guides',
      'tutorial',
      'setup',
      'walkthrough',
    ],
  },
  {
    dir: '/instructions/',
    weight: 3,
    related: [
      'instruction',
      'instructions',
      'rule',
      'rules',
      'policy',
      'agent',
      'behavior',
    ],
  },
  {
    dir: '/skills/',
    weight: 3,
    related: ['skill', 'skills', 'workflow', 'pattern', 'automation'],
  },
  {
    dir: '/patterns/',
    weight: 3,
    related: ['pattern', 'patterns', 'architecture', 'component', 'design'],
  },
];

/**
 * Hybrid keyword + semantic doc search.
 * Returns ranked results with paths, scores, and snippets.
 */
export async function searchDocs(
  query: string,
  baseDirectory: string,
  limit: number = 8,
): Promise<DocSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const tokens = tokenize(trimmedQuery);
  if (tokens.length === 0) return [];

  const docFiles = discoverDocs(baseDirectory);
  const results: DocSearchResult[] = [];

  // Phase 1: Keyword scoring
  for (const { absPath, relPath } of docFiles) {
    let fileStat: ReturnType<typeof statSync>;
    try {
      fileStat = statSync(absPath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > DOC_MAX_FILE_SIZE) continue;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const lowerPath = relPath.toLowerCase();
    let score = 0;

    // Path match
    for (const token of tokens) {
      if (lowerPath.includes(token)) {
        score += 4;
      }
      score += Math.min(countMatches(lowerContent, token, 3), 3);
    }

    if (score <= 0) continue;

    const lines = content.split(/\r?\n/g);

    // Title bonus
    const titleLine = lines.find((l) => /^#\s/.test(l));
    if (titleLine) {
      const lowerTitle = titleLine.toLowerCase();
      for (const token of tokens) {
        if (lowerTitle.includes(token)) score += 3;
      }
    }

    // Directory context bonus
    for (const { dir, weight, related } of DIR_TOKEN_MAP) {
      if (lowerPath.includes(dir)) {
        for (const token of tokens) {
          if (related.includes(token)) score += weight;
        }
        break;
      }
    }

    // Snippet extraction
    let snippet = '';
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      if (tokens.some((token) => lowerLine.includes(token))) {
        lineNumber = i + 1;
        snippet = lines[i].trim();
        break;
      }
    }

    results.push({ path: relPath, score, lineNumber, snippet });
  }

  // Phase 2: Semantic augmentation (if worker is ready)
  if (isReady()) {
    const semanticHits = await findSemantic(
      trimmedQuery,
      docFiles,
      baseDirectory,
      limit * 2,
    );
    const resultMap = new Map(results.map((r) => [r.path, r]));

    for (const hit of semanticHits) {
      if (hit.score > SEMANTIC_THRESHOLD) {
        const semanticScore = Math.round(hit.score * SEMANTIC_WEIGHT);
        const existing = resultMap.get(hit.path);
        if (existing) {
          existing.score += semanticScore;
        } else {
          const newResult: DocSearchResult = {
            path: hit.path,
            score: semanticScore,
            lineNumber: 0,
            snippet: `(semantic match, similarity: ${hit.score.toFixed(2)})`,
          };
          results.push(newResult);
          resultMap.set(hit.path, newResult);
        }
      }
    }
  }

  // Phase 3: Sort and limit
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, limit);
}

/**
 * Format search results as text for MCP tool output.
 */
const MAX_QUERY_DISPLAY_CHARS = 80;

/** Truncate a query string to a short display snippet. */
function truncateQueryDisplay(query: string): string {
  const firstLine = query.split('\n')[0].trim();
  if (firstLine.length <= MAX_QUERY_DISPLAY_CHARS) return firstLine;
  return `${firstLine.slice(0, MAX_QUERY_DISPLAY_CHARS)}…`;
}

export function formatSearchResults(
  results: DocSearchResult[],
  query: string,
): string {
  const displayQuery = truncateQueryDisplay(query);

  if (results.length === 0) {
    return `No doc matches found for "${displayQuery}".`;
  }

  const lines = [`Top doc matches for "${displayQuery}":`];
  results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.path} (score: ${item.score})`);
    if (item.snippet) {
      const prefix = item.lineNumber > 0 ? `   L${item.lineNumber}: ` : '   ';
      lines.push(`${prefix}${item.snippet}`);
    }
  });

  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize documentation context for a repository.
 *
 * Called from register_connection when baseDirectory is provided.
 * 1. Discovers docs in the repo.
 * 2. Builds a manifest of paths + titles.
 * 3. Injects the manifest via noReply into the OpenCode session.
 * 4. Kicks off background semantic indexing.
 *
 * This function is intentionally fire-and-forget — it should not delay
 * the register_connection response.
 */
export async function initDocContext(
  baseDirectory: string,
  openCodeSessionId: string,
  openCodePort: number,
  connectionId?: string,
  getWindow?: () => BrowserWindow | null,
): Promise<void> {
  const sendStatus = (status: string, type: string = 'info'): void => {
    if (connectionId && getWindow) {
      getWindow()?.webContents.send('session-status-update', {
        connectionId,
        status,
        type,
        openCodeSessionId: openCodeSessionId ?? null,
      });
    }
  };

  try {
    // 1. Discover docs
    const docFiles = discoverDocs(baseDirectory);
    if (docFiles.length === 0) {
      console.log(
        `[doc-context] no docs found in ${baseDirectory}, skipping injection`,
      );
      sendStatus('No repo docs found', 'info');
      return;
    }

    // 2. Build manifest
    const manifest = buildManifest(docFiles);
    const manifestText = formatManifest(manifest, baseDirectory);

    console.log(
      `[doc-context] found ${docFiles.length} docs in ${baseDirectory}, injecting manifest`,
    );
    sendStatus(
      `Indexed ${docFiles.length} docs, injecting manifest…`,
      'working',
    );

    // 3. Inject via noReply
    const result = await injectOpenCodeMessage(
      openCodeSessionId,
      manifestText,
      undefined,
      openCodePort,
    );
    if (!result.ok) {
      console.error(`[doc-context] manifest injection failed: ${result.error}`);
      sendStatus(`Doc manifest injection failed: ${result.error}`, 'error');
    } else {
      sendStatus(
        `${docFiles.length} docs indexed and manifest injected`,
        'success',
      );
    }

    // 4. Warm up the embedding worker and start background indexing
    warmUp();
    // Run cache build in background without blocking
    setImmediate(() => {
      buildFullCache(docFiles, baseDirectory).catch((err: unknown) => {
        console.error(
          '[doc-context] background cache build failed:',
          err instanceof Error ? err.message : err,
        );
      });
    });
  } catch (err) {
    console.error(
      '[doc-context] initDocContext failed:',
      err instanceof Error ? err.message : err,
    );
    sendStatus('Doc indexing failed', 'error');
  }
}
