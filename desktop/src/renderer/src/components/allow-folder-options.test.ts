import { describe, expect, it } from 'vitest';
import { buildAllowFolderOptions } from './allow-folder-options';

describe('buildAllowFolderOptions', () => {
  it('returns current folder and project root for a desktop project path', () => {
    expect(
      buildAllowFolderOptions(
        '/Users/josip/Desktop/interactive-mcp-server/desktop/src/main/index.ts',
      ),
    ).toEqual([
      {
        path: '/Users/josip/Desktop/interactive-mcp-server/desktop/src/main',
        label: 'Current folder',
        name: 'main',
        hint: 'Only this immediate folder',
      },
      {
        path: '/Users/josip/Desktop/interactive-mcp-server',
        label: 'Project root',
        name: 'interactive-mcp-server',
        hint: 'Recommended for this repository',
      },
    ]);
  });

  it('deduplicates project root when the file already sits directly inside it', () => {
    expect(
      buildAllowFolderOptions('/Users/josip/Desktop/project/README.md'),
    ).toEqual([
      {
        path: '/Users/josip/Desktop/project',
        label: 'Current folder',
        name: 'project',
        hint: 'Only this immediate folder',
      },
    ]);
  });
});
