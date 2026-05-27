import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDependencySpecifier } from './dependency-resolver';

describe('resolveDependencySpecifier', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'repository-index-resolver-'));
    mkdirSync(join(root, 'src', 'components'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'helper.ts'),
      'export const helper = true;',
    );
    writeFileSync(
      join(root, 'src', 'components', 'Button.tsx'),
      'export function Button() {}',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves relative imports with extension inference', () => {
    expect(resolveDependencySpecifier(root, 'src/app.ts', './helper')).toEqual({
      toPath: 'src/helper.ts',
      isExternal: false,
    });
  });

  it('resolves directory index imports', () => {
    writeFileSync(join(root, 'src', 'components', 'index.ts'), 'export {};');

    expect(
      resolveDependencySpecifier(root, 'src/app.ts', './components'),
    ).toEqual({
      toPath: 'src/components/index.ts',
      isExternal: false,
    });
  });

  it('marks package imports as external', () => {
    expect(resolveDependencySpecifier(root, 'src/app.ts', 'react')).toEqual({
      toPath: null,
      isExternal: true,
    });
  });
});
