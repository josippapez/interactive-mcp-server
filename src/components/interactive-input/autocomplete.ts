import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { AutocompleteTarget } from './types.js';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
  '.DS_Store',
]);

const MAX_REPOSITORY_FILES = 6000;
const MAX_SUGGESTIONS = 6;

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
    return files.slice(0, MAX_SUGGESTIONS);
  }

  return files
    .map((filePath) => ({
      filePath,
      score: getFuzzyScore(filePath, query),
    }))
    .filter(
      (entry): entry is { filePath: string; score: number } =>
        typeof entry.score === 'number',
    )
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.filePath);
};

export const readRepositoryFiles = async (
  repoRoot: string,
): Promise<string[]> => {
  const discoveredFiles: string[] = [];

  const visitDirectory = async (directoryPath: string): Promise<void> => {
    if (discoveredFiles.length >= MAX_REPOSITORY_FILES) {
      return;
    }

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (discoveredFiles.length >= MAX_REPOSITORY_FILES) {
        return;
      }

      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryAbsolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visitDirectory(entryAbsolutePath);
        continue;
      }

      if (entry.isFile()) {
        const relativePath = path.relative(repoRoot, entryAbsolutePath);
        if (!relativePath || relativePath.startsWith('..')) {
          continue;
        }
        discoveredFiles.push(toPosixPath(relativePath));
      }
    }
  };

  await visitDirectory(repoRoot);
  return discoveredFiles.sort((a, b) => a.localeCompare(b));
};
