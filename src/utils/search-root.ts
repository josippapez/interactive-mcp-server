import fs from 'fs/promises';
import path from 'path';

export const SEARCH_ROOT_ENV_KEY = 'INTERACTIVE_MCP_SEARCH_ROOT';

interface ResolveSearchRootRuntimeHints {
  argvEntry?: string;
  cwd?: string;
}

const normalizeAbsolutePath = (value?: string): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null;
  }

  return path.resolve(trimmed);
};

const existsAsDirectory = async (targetPath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const isGitRepositoryRoot = async (targetPath: string): Promise<boolean> => {
  if (!(await existsAsDirectory(targetPath))) {
    return false;
  }

  try {
    await fs.access(path.join(targetPath, '.git'));
    return true;
  } catch {
    return false;
  }
};

const findRepositoryRootFrom = async (
  startPath: string,
): Promise<string | null> => {
  let current = path.resolve(startPath);

  while (true) {
    if (await isGitRepositoryRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

const toDirectoryPath = async (targetPath: string): Promise<string | null> => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory() ? targetPath : path.dirname(targetPath);
  } catch {
    return null;
  }
};

const findRepositoryRootFromScriptEntry = async (
  argvEntry?: string,
): Promise<string | null> => {
  if (!argvEntry) {
    return null;
  }

  const resolvedArgvEntry = path.isAbsolute(argvEntry)
    ? path.resolve(argvEntry)
    : path.resolve(process.cwd(), argvEntry);
  const startDirectory = await toDirectoryPath(resolvedArgvEntry);
  if (!startDirectory) {
    return null;
  }

  return findRepositoryRootFrom(startDirectory);
};

export async function resolveSearchRoot(
  preferredSearchRoot?: string,
  runtimeHints: ResolveSearchRootRuntimeHints = {},
): Promise<string | undefined> {
  const preferredCandidate = normalizeAbsolutePath(preferredSearchRoot);
  if (preferredCandidate && (await isGitRepositoryRoot(preferredCandidate))) {
    return preferredCandidate;
  }

  const envCandidate = normalizeAbsolutePath(process.env[SEARCH_ROOT_ENV_KEY]);
  if (envCandidate && (await isGitRepositoryRoot(envCandidate))) {
    return envCandidate;
  }

  const argvEntryRoot = await findRepositoryRootFromScriptEntry(
    runtimeHints.argvEntry ?? process.argv[1],
  );
  if (argvEntryRoot) {
    return argvEntryRoot;
  }

  const cwdRoot = await findRepositoryRootFrom(
    runtimeHints.cwd ?? process.cwd(),
  );
  return cwdRoot ?? undefined;
}
