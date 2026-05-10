import { describe, expect, it } from 'vitest';
import {
  parseApplyPatchFileDiffs,
  parseApplyPatchMetadataFileDiffs,
  pairApplyPatchDiffLines,
} from './apply-patch-diff';

describe('ApplyPatchToolCard', () => {
  it('keeps separate apply_patch hunks from being paired together', () => {
    const files = parseApplyPatchFileDiffs({
      patchText: `*** Begin Patch
*** Update File: src/example.ts
@@ -10,2 +10,1 @@
 context before
-removed from first hunk
@@ -40,1 +39,2 @@
 context before second
+added in second hunk
*** End Patch`,
    });

    expect(files).toHaveLength(1);
    expect(files?.[0].lines).toEqual([
      {
        type: 'hunk',
        content: '@@ -10,2 +10,1 @@',
        oldLineNumber: null,
        newLineNumber: null,
      },
      {
        type: 'context',
        content: 'context before',
        oldLineNumber: 10,
        newLineNumber: 10,
      },
      {
        type: 'removal',
        content: 'removed from first hunk',
        oldLineNumber: 11,
        newLineNumber: null,
      },
      {
        type: 'hunk',
        content: '@@ -40,1 +39,2 @@',
        oldLineNumber: null,
        newLineNumber: null,
      },
      {
        type: 'context',
        content: 'context before second',
        oldLineNumber: 40,
        newLineNumber: 39,
      },
      {
        type: 'addition',
        content: 'added in second hunk',
        oldLineNumber: null,
        newLineNumber: 40,
      },
    ]);

    const paired = pairApplyPatchDiffLines(files?.[0].lines ?? [], 20);

    expect(paired.rows.map((row) => [row.left, row.right])).toEqual([
      [
        { kind: 'context', content: 'context before', lineNumber: 10 },
        { kind: 'context', content: 'context before', lineNumber: 10 },
      ],
      [
        { kind: 'removal', content: 'removed from first hunk', lineNumber: 11 },
        { kind: 'empty', content: '', lineNumber: null },
      ],
      [
        { kind: 'context', content: 'context before second', lineNumber: 40 },
        { kind: 'context', content: 'context before second', lineNumber: 39 },
      ],
      [
        { kind: 'empty', content: '', lineNumber: null },
        { kind: 'addition', content: 'added in second hunk', lineNumber: 40 },
      ],
    ]);
  });

  it('leaves line numbers blank for apply_patch hunks without ranges', () => {
    const files = parseApplyPatchFileDiffs({
      patchText: `*** Begin Patch
*** Update File: desktop/src/renderer/src/components/prompt/tool-call/ToolCallShared.tsx
@@
-import React, { memo, useEffect, useState } from 'react';
+import React, { memo, useEffect, useRef, useState } from 'react';
@@
+  const preRef = useRef<HTMLPreElement | null>(null);
*** End Patch`,
    });

    expect(files).toHaveLength(1);
    expect(files?.[0].lines).toMatchObject([
      { type: 'hunk', oldLineNumber: null, newLineNumber: null },
      { type: 'removal', oldLineNumber: null, newLineNumber: null },
      { type: 'addition', oldLineNumber: null, newLineNumber: null },
      { type: 'hunk', oldLineNumber: null, newLineNumber: null },
      { type: 'addition', oldLineNumber: null, newLineNumber: null },
    ]);

    const paired = pairApplyPatchDiffLines(files?.[0].lines ?? [], 20);

    expect(
      paired.rows.map((row) => [row.left.lineNumber, row.right.lineNumber]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('uses OpenCode apply_patch metadata patches with real hunk ranges', () => {
    const files = parseApplyPatchMetadataFileDiffs({
      files: [
        {
          filePath: '/repo/src/example.ts',
          relativePath: 'src/example.ts',
          type: 'update',
          patch: `--- /repo/src/example.ts
+++ /repo/src/example.ts
@@ -7,4 +7,5 @@
 import a from 'a';
+import b from 'b';
 
 interface Example {
@@ -53,4 +54,5 @@
   value,
 } = props;
+const next = value;
 
 return value;`,
          additions: 2,
          deletions: 0,
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files?.[0].filePath).toBe('src/example.ts');

    const paired = pairApplyPatchDiffLines(files?.[0].lines ?? [], 20);

    expect(
      paired.rows
        .filter((row) => row.right.kind === 'addition')
        .map((row) => row.right.lineNumber),
    ).toEqual([8, 56]);
  });
});
