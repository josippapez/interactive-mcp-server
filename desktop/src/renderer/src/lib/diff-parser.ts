/**
 * Diff parsing utilities for detecting and rendering file diffs from tool calls.
 *
 * These pure functions parse Edit tool input/output into structured diff data
 * that can be rendered with syntax highlighting in the ChatHistoryView.
 */

/**
 * Represents a single line in a unified diff.
 */
export interface DiffLine {
  /** Type of diff line */
  type: 'header' | 'hunk' | 'context' | 'addition' | 'removal';
  /** Raw content without the leading +/- */
  content: string;
  /** Line number in the file (null for headers/hunks) */
  lineNumber: number | null;
}

/**
 * Parsed edit tool input structure.
 */
export interface ParsedEditInput {
  filePath: string;
  oldString: string;
  newString: string;
}

/**
 * Check if a tool name represents an edit operation.
 *
 * Matches tool names like "Edit", "edit", "file_edit", "str_replace_edit".
 */
export function isEditToolCall(toolName: string): boolean {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  return lower === 'edit' || lower.endsWith('_edit') || lower.endsWith('-edit');
}

/**
 * Check if a tool name represents a read operation.
 *
 * Matches tool names like "Read", "read", "file_read".
 */
export function isReadToolCall(toolName: string): boolean {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  return lower === 'read' || lower.endsWith('_read') || lower.endsWith('-read');
}

/**
 * Parse read tool input to extract filePath.
 *
 * @returns File path or null if input doesn't match expected structure
 */
export function parseReadToolInput(
  input: Record<string, unknown> | null | undefined,
): string | null {
  if (!input || typeof input !== 'object') return null;

  const filePath = input.filePath;
  if (typeof filePath !== 'string') return null;

  return filePath;
}

/**
 * Parse edit tool input to extract filePath, oldString, and newString.
 *
 * @returns Parsed input or null if input doesn't match expected structure
 */
export function parseEditToolInput(
  input: Record<string, unknown> | null | undefined,
): ParsedEditInput | null {
  if (!input || typeof input !== 'object') return null;

  const filePath = input.filePath;
  const oldString = input.oldString;
  const newString = input.newString;

  // All three fields must be present (strings, including empty strings)
  if (typeof filePath !== 'string') return null;
  if (typeof oldString !== 'string') return null;
  if (typeof newString !== 'string') return null;

  return { filePath, oldString, newString };
}

/**
 * Generate a unified diff string from old and new content.
 *
 * This is a simplified diff generator that creates a readable diff format.
 * For complex diffs, consider using a dedicated diff library.
 */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const lines: string[] = [];

  // Header
  lines.push(`--- ${filePath}`);
  lines.push(`+++ ${filePath}`);

  // Simple LCS-based diff
  const diff = computeLineDiff(oldLines, newLines);

  // Generate hunk header
  const oldStart = 1;
  const oldCount = oldLines.length || 1;
  const newStart = 1;
  const newCount = newLines.length || 1;
  lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

  // Add diff lines
  for (const line of diff) {
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Compute line-by-line diff between old and new content.
 * Uses a simple algorithm suitable for small diffs.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): string[] {
  const result: string[] = [];

  // Use Myers diff algorithm (simplified)
  const lcs = computeLCS(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;

  for (const common of lcs) {
    // Output removals (lines in old but not yet matched)
    while (oldIdx < oldLines.length && oldLines[oldIdx] !== common) {
      result.push(`-${oldLines[oldIdx]}`);
      oldIdx++;
    }

    // Output additions (lines in new but not yet matched)
    while (newIdx < newLines.length && newLines[newIdx] !== common) {
      result.push(`+${newLines[newIdx]}`);
      newIdx++;
    }

    // Output context (common line)
    result.push(` ${common}`);
    oldIdx++;
    newIdx++;
  }

  // Output remaining removals
  while (oldIdx < oldLines.length) {
    result.push(`-${oldLines[oldIdx]}`);
    oldIdx++;
  }

  // Output remaining additions
  while (newIdx < newLines.length) {
    result.push(`+${newLines[newIdx]}`);
    newIdx++;
  }

  return result;
}

/**
 * Compute Longest Common Subsequence of two string arrays.
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Parse a unified diff string into structured DiffLine objects.
 *
 * @param diffText Raw unified diff text
 * @returns Array of parsed diff lines, empty if not valid diff format
 */
export function parseDiffLines(diffText: string): DiffLine[] {
  if (!diffText) return [];

  const lines = diffText.split('\n');
  const result: DiffLine[] = [];

  // Check if this looks like a unified diff
  const hasHeader = lines.some(
    (l) => l.startsWith('---') || l.startsWith('+++'),
  );
  const hasHunk = lines.some((l) => l.startsWith('@@'));

  if (!hasHeader && !hasHunk) return [];

  let currentLineNumber = 1;

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'header', content: line, lineNumber: null });
    } else if (line.startsWith('@@')) {
      // Parse hunk header: @@ -start,count +start,count @@
      const match = line.match(/@@ -(\d+)/);
      if (match) {
        currentLineNumber = parseInt(match[1], 10);
      }
      result.push({ type: 'hunk', content: line, lineNumber: null });
    } else if (line.startsWith('+')) {
      result.push({
        type: 'addition',
        content: line.slice(1),
        lineNumber: currentLineNumber,
      });
      currentLineNumber++;
    } else if (line.startsWith('-')) {
      result.push({
        type: 'removal',
        content: line.slice(1),
        lineNumber: currentLineNumber,
      });
      // Don't increment line number for removals
    } else if (line.startsWith(' ')) {
      result.push({
        type: 'context',
        content: line.slice(1),
        lineNumber: currentLineNumber,
      });
      currentLineNumber++;
    }
  }

  return result;
}
