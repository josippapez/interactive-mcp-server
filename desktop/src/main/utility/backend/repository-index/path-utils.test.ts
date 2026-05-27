import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isGitRepositoryRoot } from './path-utils';

describe('isGitRepositoryRoot', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'repository-index-git-root-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false for folders outside a git repository', () => {
    mkdirSync(join(root, 'Desktop'), { recursive: true });

    expect(isGitRepositoryRoot(join(root, 'Desktop'))).toBe(false);
  });

  it('does not treat nested folders as repository roots', () => {
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });

    expect(isGitRepositoryRoot(join(root, 'packages', 'app'))).toBe(false);
  });

  it('returns true when the selected folder is a git repository root', () => {
    mkdirSync(join(root, '.git'), { recursive: true });

    expect(isGitRepositoryRoot(root)).toBe(true);
  });
});
