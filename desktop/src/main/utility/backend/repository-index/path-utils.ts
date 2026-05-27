import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export function normalizeRepositoryRoot(repositoryRoot: string): string {
  return resolve(repositoryRoot);
}

export function isGitRepositoryRoot(repositoryRoot: string): boolean {
  return existsSync(join(normalizeRepositoryRoot(repositoryRoot), '.git'));
}

export function toRepositoryRelativePath(
  repositoryRoot: string,
  absolutePath: string,
): string | null {
  const rel = relative(repositoryRoot, absolutePath).split(sep).join('/');
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) return null;
  return rel;
}

export function isIgnoredRepositoryPath(path: string): boolean {
  const normalized = path.split('\\').join('/');
  const segments = normalized.split('/');
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

export function isIndexableFile(path: string): boolean {
  if (isIgnoredRepositoryPath(path)) return false;
  return true;
}

export function canExtractDependencies(path: string): boolean {
  return DEPENDENCY_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function detectLanguage(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.js')) return 'js';
  if (path.endsWith('.mjs')) return 'js';
  if (path.endsWith('.cjs')) return 'js';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.mdx')) return 'mdx';
  if (path.endsWith('.md')) return 'md';
  return 'unknown';
}

const DEPENDENCY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.nx',
  '.expo',
  '.output',
  'coverage',
  '__pycache__',
]);
