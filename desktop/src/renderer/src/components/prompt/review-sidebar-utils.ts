import type { ConversationReviewDiff } from '../../store/conversation-reducer';

export type ReviewDiffFile = ConversationReviewDiff & {
  id: string;
  file: string;
};

export type NormalizedReviewDiffs = {
  files: ReviewDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
};

export type ReviewDiffLine = {
  type: 'hunk' | 'context' | 'addition' | 'removal';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type ReviewLineComment = {
  file: string;
  lineNumber: number;
  side: 'old' | 'new';
  comment: string;
  preview: string;
};

export type ReviewFileIcon = {
  label: string;
  tone: 'blue' | 'yellow' | 'green' | 'red' | 'purple' | 'orange' | 'neutral';
};

export const REVIEW_PANEL_MIN_WIDTH = 420;
export const REVIEW_PANEL_MAX_WIDTH = 780;
export const REVIEW_INITIAL_MOUNT_COUNT = 2;

const FILE_NAME_ICONS: Record<string, ReviewFileIcon> = {
  'package.json': { label: 'NPM', tone: 'red' },
  'package-lock.json': { label: 'NPM', tone: 'red' },
  'bun.lock': { label: 'BUN', tone: 'neutral' },
  'tsconfig.json': { label: 'TS', tone: 'blue' },
  'vite.config.ts': { label: 'V', tone: 'purple' },
  'vitest.config.ts': { label: 'VT', tone: 'yellow' },
  dockerfile: { label: 'DK', tone: 'blue' },
};

const EXTENSION_ICONS: Record<string, ReviewFileIcon> = {
  ts: { label: 'TS', tone: 'blue' },
  tsx: { label: 'TSX', tone: 'blue' },
  js: { label: 'JS', tone: 'yellow' },
  jsx: { label: 'JSX', tone: 'yellow' },
  json: { label: '{}', tone: 'yellow' },
  css: { label: 'CSS', tone: 'blue' },
  scss: { label: 'SC', tone: 'purple' },
  md: { label: 'MD', tone: 'neutral' },
  mdx: { label: 'MDX', tone: 'purple' },
  html: { label: 'HT', tone: 'orange' },
  svg: { label: 'SVG', tone: 'orange' },
  yml: { label: 'YML', tone: 'purple' },
  yaml: { label: 'YML', tone: 'purple' },
  toml: { label: 'TOML', tone: 'purple' },
  py: { label: 'PY', tone: 'blue' },
  rs: { label: 'RS', tone: 'orange' },
  go: { label: 'GO', tone: 'blue' },
  sh: { label: 'SH', tone: 'green' },
  sql: { label: 'SQL', tone: 'purple' },
};

export function normalizeReviewDiffs(
  diffs: readonly ConversationReviewDiff[],
): NormalizedReviewDiffs {
  const files: ReviewDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  diffs.forEach((diff, index) => {
    if (typeof diff.file !== 'string' || diff.file.length === 0) return;

    totalAdditions += diff.additions;
    totalDeletions += diff.deletions;
    files.push({ ...diff, file: diff.file, id: `${diff.file}:${index}` });
  });

  return { files, totalAdditions, totalDeletions };
}

export function parseReviewDiffPatch(patch: string): ReviewDiffLine[] {
  const lines: ReviewDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) continue;

    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(
        /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
      );
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      lines.push({
        type: 'hunk',
        content: rawLine,
        oldLineNumber: null,
        newLineNumber: null,
      });
      continue;
    }

    if (rawLine.startsWith('+')) {
      lines.push({
        type: 'addition',
        content: rawLine.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-')) {
      lines.push({
        type: 'removal',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
      continue;
    }

    if (rawLine.startsWith(' ')) {
      lines.push({
        type: 'context',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  return lines;
}

export function splitReviewPath(path: string): {
  directory: string;
  filename: string;
} {
  const index = path.lastIndexOf('/');
  if (index === -1) return { directory: '', filename: path };
  return {
    directory: path.slice(0, index + 1),
    filename: path.slice(index + 1),
  };
}

export function getReviewFileIcon(path: string): ReviewFileIcon {
  const fileName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  const byName = FILE_NAME_ICONS[fileName];
  if (byName) return byName;

  const parts = fileName.split('.');
  for (let index = 1; index < parts.length; index += 1) {
    const compound = parts.slice(index).join('.');
    const icon = EXTENSION_ICONS[compound];
    if (icon) return icon;
  }

  return { label: 'TXT', tone: 'neutral' };
}

export function normalizeReviewPanelWidth(
  width: number,
  viewportWidth: number,
): number {
  const viewportMax = Math.max(
    REVIEW_PANEL_MIN_WIDTH,
    Math.floor(viewportWidth * 0.65),
  );
  const max = Math.min(REVIEW_PANEL_MAX_WIDTH, viewportMax);
  return Math.min(Math.max(width, REVIEW_PANEL_MIN_WIDTH), max);
}

export function shouldMountReviewDiff({
  index,
  open,
  force,
}: {
  index: number;
  open: boolean;
  force: boolean;
}): boolean {
  if (!open) return false;
  return force || index < REVIEW_INITIAL_MOUNT_COUNT;
}

export function formatReviewCommentPrompt({
  file,
  lineNumber,
  side,
  comment,
  preview,
}: ReviewLineComment): string {
  const sideLabel = side === 'new' ? 'new' : 'old';
  const previewBlock = preview
    ? `\n\nLine preview:\n\`\`\`\n${preview}\n\`\`\``
    : '';
  return `Review comment on ${file}:${lineNumber} (${sideLabel} side):\n\n${comment}${previewBlock}`;
}
