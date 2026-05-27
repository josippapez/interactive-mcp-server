import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

export function resolveDependencySpecifier(
  repositoryRoot: string,
  fromPath: string,
  specifier: string,
): { toPath: string | null; isExternal: boolean } {
  if (!specifier.startsWith('.')) {
    return { toPath: null, isExternal: true };
  }

  const fromDirectory = dirname(join(repositoryRoot, fromPath));
  const candidateBase = normalize(join(fromDirectory, specifier));
  const resolved = resolveFile(candidateBase);
  if (!resolved) return { toPath: null, isExternal: false };

  const rel = relative(repositoryRoot, resolved).split(sep).join('/');
  if (rel.startsWith('..') || rel.startsWith('/')) {
    return { toPath: null, isExternal: false };
  }

  return { toPath: rel, isExternal: false };
}

function resolveFile(candidateBase: string): string | null {
  if (existsSync(candidateBase)) {
    const stats = statSync(candidateBase);
    if (stats.isFile()) return candidateBase;
    if (stats.isDirectory()) {
      for (const extension of FILE_EXTENSIONS) {
        const indexPath = join(candidateBase, `index${extension}`);
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          return indexPath;
        }
      }
    }
  }

  for (const extension of FILE_EXTENSIONS) {
    const filePath = `${candidateBase}${extension}`;
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  }

  return null;
}
