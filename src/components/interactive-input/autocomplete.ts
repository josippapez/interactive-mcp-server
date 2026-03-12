import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { AutocompleteTarget } from './types.js';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.bun',
  '.yarn',
  '.pnpm',
  '.pnpm-store',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vercel',
  '.turbo',
  '.output',
  'out',
  '.idea',
  '.vscode',
  '.history',
  '.tmp',
  'tmp',
  'temp',
  '.venv',
  'venv',
  '.pytest_cache',
  '.DS_Store',
]);

const MAX_REPOSITORY_ENTRIES = 50000;
const MAX_VISIBLE_SUGGESTIONS = 50;

const toPosixPath = (value: string): string => value.replaceAll(path.sep, '/');

const getFuzzyScore = (candidate: string, query: string): number | null => {
  const candidateLower = candidate.toLowerCase();
  const queryLower = query.toLowerCase();

  if (candidateLower.includes(queryLower)) {
    const index = candidateLower.indexOf(queryLower);
    const startsWithBonus = index === 0 ? 20 : 0;
    return 1000 - index * 5 - candidate.length + startsWithBonus;
  }

  let queryIndex = 0;
  let score = 0;
  let runLength = 0;

  for (
    let i = 0;
    i < candidateLower.length && queryIndex < queryLower.length;
    i++
  ) {
    if (candidateLower[i] === queryLower[queryIndex]) {
      queryIndex += 1;
      runLength += 1;
      score += 2 + runLength;
    } else {
      runLength = 0;
      score -= 0.2;
    }
  }

  if (queryIndex !== queryLower.length) {
    return null;
  }

  return score - candidate.length * 0.1;
};

interface ScoredSuggestion {
  filePath: string;
  score: number;
}

const isHigherRanked = (
  left: ScoredSuggestion,
  right: ScoredSuggestion,
): boolean =>
  left.score > right.score ||
  (left.score === right.score &&
    left.filePath.localeCompare(right.filePath) < 0);

const collectTopRankedSuggestions = (
  files: string[],
  query: string,
  limit: number,
): ScoredSuggestion[] => {
  const topRanked: ScoredSuggestion[] = [];

  for (const filePath of files) {
    const score = getFuzzyScore(filePath, query);
    if (score === null) {
      continue;
    }

    const scoredSuggestion: ScoredSuggestion = { filePath, score };
    const insertionIndex = topRanked.findIndex((candidate) =>
      isHigherRanked(scoredSuggestion, candidate),
    );

    if (insertionIndex === -1) {
      if (topRanked.length < limit) {
        topRanked.push(scoredSuggestion);
      }
      continue;
    }

    topRanked.splice(insertionIndex, 0, scoredSuggestion);
    if (topRanked.length > limit) {
      topRanked.pop();
    }
  }

  return topRanked;
};

export const getAutocompleteTarget = (
  value: string,
  caret: number,
): AutocompleteTarget | null => {
  const clampedCaret = Math.max(0, Math.min(caret, value.length));
  let start = clampedCaret;
  const separators = new Set([' ', '\n', '\t', '"', "'", '(', ')', '[', ']']);
  const isWhitespace = (character: string): boolean =>
    character === ' ' || character === '\n' || character === '\t';

  while (start > 0 && !separators.has(value[start - 1])) {
    start -= 1;
  }

  const token = value.slice(start, clampedCaret);
  if (token.startsWith('#')) {
    return {
      start,
      end: clampedCaret,
      query: token.slice(1),
    };
  }

  let probe = start;
  while (probe > 0 && isWhitespace(value[probe - 1])) {
    probe -= 1;
  }

  if (probe <= 0 || value[probe - 1] !== '#') {
    return null;
  }

  const hashIndex = probe - 1;
  if (hashIndex > 0 && !separators.has(value[hashIndex - 1])) {
    return null;
  }

  return {
    start: hashIndex,
    end: clampedCaret,
    query: value.slice(hashIndex + 1, clampedCaret).trimStart(),
  };
};

export const rankFileSuggestions = (
  files: string[],
  query: string,
): string[] => {
  if (query.length === 0) {
    return files.slice(0, MAX_VISIBLE_SUGGESTIONS);
  }

  return collectTopRankedSuggestions(files, query, MAX_VISIBLE_SUGGESTIONS).map(
    (entry) => entry.filePath,
  );
};

export const readRepositoryFiles = async (
  repoRoot: string,
): Promise<string[]> => {
  const discoveredFiles: string[] = [];

  const visitDirectory = async (directoryPath: string): Promise<void> => {
    if (discoveredFiles.length >= MAX_REPOSITORY_ENTRIES) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (discoveredFiles.length >= MAX_REPOSITORY_ENTRIES) {
        return;
      }

      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const entryAbsolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(repoRoot, entryAbsolutePath);
      if (!relativePath || relativePath.startsWith('..')) {
        continue;
      }

      if (entry.isDirectory()) {
        discoveredFiles.push(`${toPosixPath(relativePath)}/`);
        await visitDirectory(entryAbsolutePath);
        continue;
      }

      if (entry.isFile()) {
        discoveredFiles.push(toPosixPath(relativePath));
      }
    }
  };

  await visitDirectory(repoRoot);
  return discoveredFiles.sort((a, b) => a.localeCompare(b));
};
