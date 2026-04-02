const fs = require('node:fs');
const path = require('node:path');
const { ROOT, MAX_FILE_SIZE_BYTES, SKIP_DIRS } = require('../config.cjs');
const { isReady, findSemantic } = require('../semantic-index.cjs');

const docsTool = {
  name: 'find_docs',
  description:
    'Find relevant repository docs by query without loading all docs up front.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for repository docs and markdown files.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of matches to return.',
        minimum: 1,
        maximum: 20,
        default: 8,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const readDocTool = {
  name: 'read_doc',
  description:
    'Read the full content of a repository documentation file by its relative path. Use find_docs first to discover relevant file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Relative file path from the repository root (e.g. docs/guides/mobile/build-new-feature-mobile.md).',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

const listDocsTool = {
  name: 'list_docs',
  description:
    'List available repository documentation paths so you can browse what exists before searching or reading.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description:
          'Which documentation set to list: all, docs_only, or readmes_only.',
        enum: ['all', 'docs_only', 'readmes_only'],
        default: 'all',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of paths to return in one call.',
        minimum: 1,
        maximum: 5000,
        default: 200,
      },
      offset: {
        type: 'integer',
        description:
          'Zero-based index of the first item to return (for pagination).',
        minimum: 0,
        default: 0,
      },
    },
    additionalProperties: false,
  },
};

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

function tokenize(input) {
  const raw = String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/g)
    .filter(Boolean);
  const filtered = raw.filter((t) => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : raw;
}

function countMatches(text, token, cap = 8) {
  let idx = 0;
  let count = 0;
  while (count < cap) {
    idx = text.indexOf(token, idx);
    if (idx === -1) {
      break;
    }
    count += 1;
    idx += token.length || 1;
  }
  return count;
}

function walkDirectory(dirPath, visitor) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
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

function getDocFiles() {
  const files = [];
  const docsRoot = path.join(ROOT, 'docs');
  if (fs.existsSync(docsRoot)) {
    walkDirectory(docsRoot, (filePath) => {
      if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
        files.push(filePath);
      }
    });
  }

  const rootReadme = path.join(ROOT, 'README.md');
  if (fs.existsSync(rootReadme)) {
    files.push(rootReadme);
  }

  for (const topDir of ['apps', 'libs', 'tools']) {
    const targetDir = path.join(ROOT, topDir);
    if (!fs.existsSync(targetDir)) {
      continue;
    }
    walkDirectory(targetDir, (filePath) => {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('/readme.md')) {
        files.push(filePath);
      }
    });
  }

  return Array.from(new Set(files));
}

function listDocs(args) {
  const source = String(args?.source || 'all').trim();
  const limit = Math.min(Math.max(Number(args?.limit || 200), 1), 5000);
  const offset = Math.max(Number(args?.offset || 0), 0);

  if (!['all', 'docs_only', 'readmes_only'].includes(source)) {
    return 'Invalid source. Use one of: all, docs_only, readmes_only.';
  }

  let paths = getDocFiles().map((filePath) => path.relative(ROOT, filePath));

  if (source === 'docs_only') {
    paths = paths.filter((p) => p.startsWith('docs/'));
  } else if (source === 'readmes_only') {
    paths = paths.filter(
      (p) => p.toLowerCase().endsWith('/readme.md') || p === 'README.md',
    );
  }

  paths.sort((a, b) => a.localeCompare(b));

  if (paths.length === 0) {
    return `No documentation files found for source="${source}".`;
  }

  if (offset >= paths.length) {
    return `Offset ${offset} is out of range for ${paths.length} docs.`;
  }

  const page = paths.slice(offset, offset + limit);
  const lines = [
    `Docs list (source=${source}) showing ${page.length} of ${paths.length} total (offset=${offset}, limit=${limit}):`,
  ];

  page.forEach((item, index) => {
    lines.push(`${offset + index + 1}. ${item}`);
  });

  const nextOffset = offset + page.length;
  if (nextOffset < paths.length) {
    lines.push(`More available: call list_docs with offset=${nextOffset}.`);
  }

  return lines.join('\n');
}

async function findDocs(args) {
  const query = String(args?.query || '').trim();
  const limit = Math.min(Math.max(Number(args?.limit || 8), 1), 20);
  if (!query) {
    return 'Please provide a non-empty query.';
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return 'Please provide a more specific query.';
  }

  const results = [];
  const docFiles = getDocFiles();

  for (const filePath of docFiles) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const lowerPath = path.relative(ROOT, filePath).toLowerCase();
    let score = 0;

    for (const token of tokens) {
      if (lowerPath.includes(token)) {
        score += 4;
      }
      score += Math.min(countMatches(lowerContent, token, 3), 3);
    }

    if (score <= 0) {
      continue;
    }

    const lines = content.split(/\r?\n/g);

    // Title bonus: tokens matching the H1 heading get extra weight
    const titleLine = lines.find((l) => /^#\s/.test(l));
    if (titleLine) {
      const lowerTitle = titleLine.toLowerCase();
      for (const token of tokens) {
        if (lowerTitle.includes(token)) {
          score += 3;
        }
      }
    }

    // Directory context bonus: docs in standards/guides dirs get credit
    // when query intent aligns (e.g. "best practices" ≈ standards)
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
    ];
    for (const { dir, weight, related } of DIR_TOKEN_MAP) {
      if (lowerPath.includes(dir)) {
        for (const token of tokens) {
          if (related.includes(token)) {
            score += weight;
          }
        }
        break;
      }
    }

    let snippet = '';
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lowerLine = lines[i].toLowerCase();
      if (tokens.some((token) => lowerLine.includes(token))) {
        lineNumber = i + 1;
        snippet = lines[i].trim();
        break;
      }
    }

    results.push({
      path: path.relative(ROOT, filePath),
      score,
      lineNumber,
      snippet,
    });
  }

  const needsSemantic = isReady();

  if (needsSemantic) {
    const semanticHits = await findSemantic(query, docFiles, limit * 2);
    const resultMap = new Map(results.map((r) => [r.path, r]));
    for (const hit of semanticHits) {
      if (hit.score > 0.3) {
        const semanticScore = Math.round(hit.score * 14);
        const existing = resultMap.get(hit.path);
        if (existing) {
          existing.score += semanticScore;
        } else {
          results.push({
            path: hit.path,
            score: semanticScore,
            lineNumber: 0,
            snippet: `(semantic match, similarity: ${hit.score.toFixed(2)})`,
          });
          resultMap.set(hit.path, results[results.length - 1]);
        }
      }
    }
  }

  if (results.length === 0) {
    return `No doc matches found for "${query}".`;
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const top = results.slice(0, limit);

  const lines = [`Top doc matches for "${query}":`];
  top.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.path} (score: ${item.score})`);
    if (item.snippet) {
      const prefix = item.lineNumber > 0 ? `   L${item.lineNumber}: ` : '   ';
      lines.push(`${prefix}${item.snippet}`);
    }
  });

  return lines.join('\n');
}

function readDoc(args) {
  const relPath = String(args?.path || '').trim();
  if (!relPath) {
    return 'Please provide a non-empty path.';
  }

  const absPath = path.resolve(ROOT, relPath);
  if (!absPath.startsWith(ROOT + path.sep)) {
    return 'Path is outside the repository root.';
  }

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return `File not found: ${relPath}`;
  }

  if (!stat.isFile()) {
    return `Not a regular file: ${relPath}`;
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE_BYTES}): ${relPath}`;
  }

  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return `Read error: ${err.message}`;
  }
}

module.exports = {
  docsTool,
  readDocTool,
  listDocsTool,
  findDocs,
  readDoc,
  listDocs,
};
