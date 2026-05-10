export type PatchAction = 'add' | 'update' | 'delete' | 'move';
export type PatchLineType = 'hunk' | 'context' | 'addition' | 'removal';

export type PatchLine = {
  type: PatchLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type ApplyPatchFileDiff = {
  id: string;
  action: PatchAction;
  filePath: string;
  fromPath?: string;
  additions: number;
  deletions: number;
  lines: PatchLine[];
};

type OpenCodeApplyPatchMetadataFile = {
  filePath?: unknown;
  relativePath?: unknown;
  type?: unknown;
  patch?: unknown;
  additions?: unknown;
  deletions?: unknown;
  movePath?: unknown;
};

type BuildFileDraft = {
  action: PatchAction;
  filePath: string;
  fromPath?: string;
  moveToPath?: string;
  rawLines: string[];
};

type SideCellKind = 'empty' | 'context' | 'removal' | 'addition';

type SideCell = {
  kind: SideCellKind;
  content: string;
  lineNumber: number | null;
};

type SideBySideRow = {
  key: string;
  left: SideCell;
  right: SideCell;
};

const EMPTY_CELL: SideCell = { kind: 'empty', content: '', lineNumber: null };

function getStringField(
  input: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = input?.[key];
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  return value;
}

function getPatchText(input?: Record<string, unknown>): string | null {
  const patchText =
    getStringField(input, 'patchText') ??
    getStringField(input, 'patch') ??
    getStringField(input, 'text');

  if (!patchText) return null;
  return patchText;
}

function normalizeMetadataAction(
  value: unknown,
  hasMovePath: boolean,
): PatchAction | null {
  if (hasMovePath) return 'move';
  if (value === 'add') return 'add';
  if (value === 'delete') return 'delete';
  if (value === 'move') return 'move';
  if (value === 'update' || value === 'modified') return 'update';
  return null;
}

function startsWithHeader(line: string): boolean {
  return (
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Update File: ') ||
    line.startsWith('*** Delete File: ')
  );
}

function parseHeader(
  line: string,
): { action: PatchAction; filePath: string } | null {
  if (line.startsWith('*** Add File: ')) {
    return {
      action: 'add',
      filePath: line.replace('*** Add File: ', '').trim(),
    };
  }

  if (line.startsWith('*** Update File: ')) {
    return {
      action: 'update',
      filePath: line.replace('*** Update File: ', '').trim(),
    };
  }

  if (line.startsWith('*** Delete File: ')) {
    return {
      action: 'delete',
      filePath: line.replace('*** Delete File: ', '').trim(),
    };
  }

  return null;
}

function toPatchLines(rawLines: string[]): {
  lines: PatchLine[];
  additions: number;
  deletions: number;
} {
  const lines: PatchLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 1;
  let newLine = 1;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(
        /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
      );
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      lines.push({
        type: 'hunk',
        content: rawLine,
        oldLineNumber: null,
        newLineNumber: null,
      });
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      additions += 1;
      lines.push({
        type: 'addition',
        content: rawLine.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine > 0 ? newLine : null,
      });
      if (newLine > 0) newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      deletions += 1;
      lines.push({
        type: 'removal',
        content: rawLine.slice(1),
        oldLineNumber: oldLine > 0 ? oldLine : null,
        newLineNumber: null,
      });
      if (oldLine > 0) oldLine += 1;
      continue;
    }

    if (!rawLine.startsWith(' ')) continue;

    lines.push({
      type: 'context',
      content: rawLine.slice(1),
      oldLineNumber: oldLine > 0 ? oldLine : null,
      newLineNumber: newLine > 0 ? newLine : null,
    });
    if (oldLine > 0) oldLine += 1;
    if (newLine > 0) newLine += 1;
  }

  return { lines, additions, deletions };
}

function toPatchLinesFromUnifiedDiff(diffText: string): {
  lines: PatchLine[];
  additions: number;
  deletions: number;
} {
  return toPatchLines(
    diffText
      .split('\n')
      .filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ ')),
  );
}

function toFileDiff(draft: BuildFileDraft, index: number): ApplyPatchFileDiff {
  const normalizedAction =
    draft.moveToPath && draft.action === 'update' ? 'move' : draft.action;

  const { lines, additions, deletions } = toPatchLines(draft.rawLines);

  const filePath = draft.moveToPath ?? draft.filePath;
  const fromPath = draft.moveToPath ? draft.filePath : draft.fromPath;

  return {
    id: `${normalizedAction}:${filePath}:${index}`,
    action: normalizedAction,
    filePath,
    fromPath,
    additions,
    deletions,
    lines,
  };
}

export function parseApplyPatchFileDiffs(
  input?: Record<string, unknown>,
): ApplyPatchFileDiff[] | null {
  const patchText = getPatchText(input);
  if (!patchText) return null;

  const rawLines = patchText.split('\n');
  const beginIndex = rawLines.findIndex(
    (line) => line.trim() === '*** Begin Patch',
  );
  const endIndex = rawLines.findIndex(
    (line) => line.trim() === '*** End Patch',
  );

  if (beginIndex < 0 || endIndex <= beginIndex) return null;

  const patchLines = rawLines.slice(beginIndex + 1, endIndex);
  const files: ApplyPatchFileDiff[] = [];
  let draft: BuildFileDraft | null = null;

  const flushDraft = () => {
    if (!draft) return;
    files.push(toFileDiff(draft, files.length));
    draft = null;
  };

  for (const line of patchLines) {
    if (startsWithHeader(line)) {
      flushDraft();

      const header = parseHeader(line);
      if (!header) continue;

      draft = {
        action: header.action,
        filePath: header.filePath,
        rawLines: [],
      };
      continue;
    }

    if (!draft) continue;

    if (line.startsWith('*** Move to: ')) {
      draft.moveToPath = line.replace('*** Move to: ', '').trim();
      continue;
    }

    if (
      line.startsWith('@@') ||
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---')) ||
      line.startsWith(' ')
    ) {
      draft.rawLines.push(line);
    }
  }

  flushDraft();

  if (files.length === 0) return null;
  return files;
}

export function parseApplyPatchMetadataFileDiffs(
  metadata?: Record<string, unknown>,
): ApplyPatchFileDiff[] | null {
  if (!metadata) return null;
  if (!Array.isArray(metadata.files)) return null;

  const files: ApplyPatchFileDiff[] = [];
  for (const file of metadata.files as OpenCodeApplyPatchMetadataFile[]) {
    if (typeof file.filePath !== 'string') continue;
    if (typeof file.patch !== 'string') continue;
    const hasMovePath = typeof file.movePath === 'string';
    const action = normalizeMetadataAction(file.type, hasMovePath);
    if (!action) continue;

    const parsed = toPatchLinesFromUnifiedDiff(file.patch);
    files.push({
      id: `${action}:${file.filePath}:${files.length}`,
      action,
      filePath:
        typeof file.relativePath === 'string'
          ? file.relativePath
          : file.filePath,
      fromPath: hasMovePath ? file.filePath : undefined,
      additions:
        typeof file.additions === 'number' ? file.additions : parsed.additions,
      deletions:
        typeof file.deletions === 'number' ? file.deletions : parsed.deletions,
      lines: parsed.lines,
    });
  }

  if (files.length === 0) return null;
  return files;
}

export function pairApplyPatchDiffLines(
  lines: ReadonlyArray<PatchLine>,
  maxRows: number,
): { rows: SideBySideRow[]; truncated: boolean; totalRows: number } {
  const rows: SideBySideRow[] = [];
  let totalRows = 0;

  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].type === 'hunk') {
      i += 1;
    }

    if (i >= lines.length) {
      continue;
    }

    while (i < lines.length && lines[i].type !== 'hunk') {
      const current = lines[i];

      if (current.type === 'context') {
        totalRows += 1;
        if (rows.length < maxRows) {
          rows.push({
            key: `row-${rows.length}`,
            left: {
              kind: 'context',
              content: current.content,
              lineNumber: current.oldLineNumber,
            },
            right: {
              kind: 'context',
              content: current.content,
              lineNumber: current.newLineNumber,
            },
          });
        }
        i += 1;
        continue;
      }

      const removals: PatchLine[] = [];
      const additions: PatchLine[] = [];
      while (i < lines.length && lines[i].type === 'removal') {
        removals.push(lines[i]);
        i += 1;
      }
      while (i < lines.length && lines[i].type === 'addition') {
        additions.push(lines[i]);
        i += 1;
      }

      const pairCount = Math.max(removals.length, additions.length);
      for (let p = 0; p < pairCount; p += 1) {
        const removal = removals[p];
        const addition = additions[p];
        totalRows += 1;
        if (rows.length < maxRows) {
          rows.push({
            key: `row-${rows.length}`,
            left: removal
              ? {
                  kind: 'removal',
                  content: removal.content,
                  lineNumber: removal.oldLineNumber,
                }
              : EMPTY_CELL,
            right: addition
              ? {
                  kind: 'addition',
                  content: addition.content,
                  lineNumber: addition.newLineNumber,
                }
              : EMPTY_CELL,
          });
        }
      }
    }
  }

  return { rows, truncated: totalRows > maxRows, totalRows };
}
