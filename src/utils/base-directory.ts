import fs from 'fs/promises';
import path from 'path';

/**
 * Validate that the provided base directory is an absolute path pointing to a
 * git repository root (contains a `.git` entry).
 */
export async function validateRepositoryBaseDirectory(
  baseDirectory: string,
): Promise<string> {
  if (baseDirectory.trim().length === 0) {
    throw new Error(
      'Invalid baseDirectory: value cannot be empty. Provide an absolute path to the current repository root.',
    );
  }

  if (!path.isAbsolute(baseDirectory)) {
    throw new Error(
      'Invalid baseDirectory: path must be absolute and point to the current repository root.',
    );
  }

  const normalizedPath = path.resolve(baseDirectory);

  let baseDirectoryStats;
  try {
    baseDirectoryStats = await fs.stat(normalizedPath);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(
        `Invalid baseDirectory: "${normalizedPath}" does not exist. Provide an absolute path to the current repository root.`,
      );
    }

    throw new Error(
      `Invalid baseDirectory: unable to access "${normalizedPath}". Provide an absolute path to the current repository root.`,
    );
  }

  if (!baseDirectoryStats.isDirectory()) {
    throw new Error(
      `Invalid baseDirectory: "${normalizedPath}" is not a directory. Provide an absolute path to the current repository root.`,
    );
  }

  try {
    await fs.access(path.join(normalizedPath, '.git'));
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(
        `Invalid baseDirectory: "${normalizedPath}" is not a git repository root (missing ".git").`,
      );
    }

    throw new Error(
      `Invalid baseDirectory: unable to verify ".git" in "${normalizedPath}".`,
    );
  }

  return normalizedPath;
}
