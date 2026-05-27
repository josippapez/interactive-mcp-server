import { describe, expect, it } from 'vitest';
import { extractDependenciesFromSource } from './dependency-extractor';

describe('extractDependenciesFromSource', () => {
  it('extracts static, re-export, dynamic, and require dependencies', () => {
    const dependencies = extractDependenciesFromSource(
      [
        "import React from 'react';",
        "import { helper } from './helper';",
        "export { thing } from '../thing';",
        "const lazy = import('./lazy');",
        "const cjs = require('./cjs');",
      ].join('\n'),
      'src/app.tsx',
    );

    expect(dependencies).toEqual([
      {
        specifier: 'react',
        kind: 'import',
        lineNumber: 1,
        lineSnippet: "import React from 'react';",
      },
      {
        specifier: './helper',
        kind: 'import',
        lineNumber: 2,
        lineSnippet: "import { helper } from './helper';",
      },
      {
        specifier: '../thing',
        kind: 'export',
        lineNumber: 3,
        lineSnippet: "export { thing } from '../thing';",
      },
      {
        specifier: './lazy',
        kind: 'dynamic-import',
        lineNumber: 4,
        lineSnippet: "const lazy = import('./lazy');",
      },
      {
        specifier: './cjs',
        kind: 'require',
        lineNumber: 5,
        lineSnippet: "const cjs = require('./cjs');",
      },
    ]);
  });

  it('ignores non JavaScript-like files', () => {
    expect(
      extractDependenciesFromSource("import x from './x'", 'README.md'),
    ).toEqual([]);
  });
});
