import { readdir } from 'fs/promises';
import { join, relative, posix } from 'path';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '.venv',
  'build',
  '.pnpm',
  '__pycache__',
  '.cache',
  '.turbo',
  '.nx',
  '.expo',
  '.output',
  'coverage',
  '.parcel-cache',
]);

const MAX_FILES = 50_000;

const indexCache = new Map<string, { files: string[]; timestamp: number }>();
const CACHE_TTL_MS = 30_000;

export async function indexFiles(baseDirectory: string): Promise<string[]> {
  const cached = indexCache.get(baseDirectory);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.files;
  }

  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;

      if (entry.isDirectory()) {
        if (
          IGNORED_DIRS.has(entry.name) ||
          entry.name.startsWith('.DS_Store')
        ) {
          continue;
        }
        await walk(join(dir, entry.name));
      } else {
        const rel = relative(baseDirectory, join(dir, entry.name));
        files.push(rel.split('\\').join(posix.sep));
      }
    }
  }

  await walk(baseDirectory);
  files.sort();

  indexCache.set(baseDirectory, { files, timestamp: Date.now() });
  return files;
}

export function rankFileSuggestions(
  files: string[],
  query: string,
  limit: number,
): string[] {
  if (!query) return files.slice(0, limit);

  const lowerQuery = query.toLowerCase();
  const scored: { path: string; score: number }[] = [];

  for (const filePath of files) {
    const lowerPath = filePath.toLowerCase();

    // Check substring match
    const substringIdx = lowerPath.indexOf(lowerQuery);
    if (substringIdx !== -1) {
      // Substring match found — high base score
      let score = 1000;
      // Bonus if match is at start
      if (substringIdx === 0) score += 500;
      // Bonus if match is at start of a path segment
      if (substringIdx === 0 || lowerPath[substringIdx - 1] === '/')
        score += 300;
      // Bonus for shorter paths (more specific)
      score -= filePath.length;
      scored.push({ path: filePath, score });
      continue;
    }

    // Fuzzy character-by-character matching
    const fuzzyScore = fuzzyMatch(lowerPath, lowerQuery);
    if (fuzzyScore > 0) {
      scored.push({ path: filePath, score: fuzzyScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.path);
}

function fuzzyMatch(text: string, query: string): number {
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchIdx = -2;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      qi++;
      score += 10;
      // Consecutive character bonus
      if (ti === lastMatchIdx + 1) {
        consecutive++;
        score += consecutive * 5;
      } else {
        consecutive = 0;
      }
      // Bonus for matching at path separator boundary
      if (ti === 0 || text[ti - 1] === '/') {
        score += 15;
      }
      lastMatchIdx = ti;
    }
  }

  // All query characters must be found
  if (qi < query.length) return 0;

  // Penalize longer paths
  score -= text.length;

  return Math.max(score, 1);
}
