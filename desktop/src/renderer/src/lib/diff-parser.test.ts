import { describe, it, expect } from 'vitest';
import {
  isEditToolCall,
  parseEditToolInput,
  generateUnifiedDiff,
  parseDiffLines,
  type DiffLine,
} from './diff-parser';

describe('isEditToolCall', () => {
  it('returns true for "Edit" tool name', () => {
    expect(isEditToolCall('Edit')).toBe(true);
  });

  it('returns true for "edit" tool name (case insensitive)', () => {
    expect(isEditToolCall('edit')).toBe(true);
  });

  it('returns true for tool names containing "edit" at the end', () => {
    expect(isEditToolCall('file_edit')).toBe(true);
    expect(isEditToolCall('str_replace_edit')).toBe(true);
  });

  it('returns false for non-edit tool names', () => {
    expect(isEditToolCall('Read')).toBe(false);
    expect(isEditToolCall('Bash')).toBe(false);
    expect(isEditToolCall('Write')).toBe(false);
  });

  it('returns false for empty or undefined tool names', () => {
    expect(isEditToolCall('')).toBe(false);
    expect(isEditToolCall(undefined as unknown as string)).toBe(false);
  });
});

describe('parseEditToolInput', () => {
  it('parses valid edit tool input with filePath, oldString, and newString', () => {
    const input = {
      filePath: '/path/to/file.ts',
      oldString: 'const foo = 1;',
      newString: 'const foo = 2;',
    };

    const result = parseEditToolInput(input);

    expect(result).toEqual({
      filePath: '/path/to/file.ts',
      oldString: 'const foo = 1;',
      newString: 'const foo = 2;',
    });
  });

  it('returns null for input missing filePath', () => {
    const input = {
      oldString: 'foo',
      newString: 'bar',
    };

    expect(parseEditToolInput(input)).toBeNull();
  });

  it('returns null for input missing oldString', () => {
    const input = {
      filePath: '/path/to/file.ts',
      newString: 'bar',
    };

    expect(parseEditToolInput(input)).toBeNull();
  });

  it('returns null for input missing newString', () => {
    const input = {
      filePath: '/path/to/file.ts',
      oldString: 'foo',
    };

    expect(parseEditToolInput(input)).toBeNull();
  });

  it('returns null for null or undefined input', () => {
    expect(parseEditToolInput(null)).toBeNull();
    expect(parseEditToolInput(undefined)).toBeNull();
  });

  it('handles empty strings in oldString and newString', () => {
    const input = {
      filePath: '/path/to/file.ts',
      oldString: '',
      newString: 'new content',
    };

    const result = parseEditToolInput(input);

    expect(result).toEqual({
      filePath: '/path/to/file.ts',
      oldString: '',
      newString: 'new content',
    });
  });
});

describe('generateUnifiedDiff', () => {
  it('generates a simple single-line diff', () => {
    const result = generateUnifiedDiff(
      'const foo = 1;',
      'const foo = 2;',
      '/path/to/file.ts',
    );

    expect(result).toContain('--- /path/to/file.ts');
    expect(result).toContain('+++ /path/to/file.ts');
    expect(result).toContain('-const foo = 1;');
    expect(result).toContain('+const foo = 2;');
  });

  it('generates a multi-line diff', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nmodified\nline3';

    const result = generateUnifiedDiff(oldContent, newContent, 'test.ts');

    expect(result).toContain('-line2');
    expect(result).toContain('+modified');
    expect(result).toContain(' line1');
    expect(result).toContain(' line3');
  });

  it('handles addition of new lines', () => {
    const oldContent = 'line1\nline2';
    const newContent = 'line1\nline2\nline3';

    const result = generateUnifiedDiff(oldContent, newContent, 'test.ts');

    expect(result).toContain('+line3');
  });

  it('handles removal of lines', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nline3';

    const result = generateUnifiedDiff(oldContent, newContent, 'test.ts');

    expect(result).toContain('-line2');
  });

  it('handles empty old content (new file addition)', () => {
    const result = generateUnifiedDiff('', 'new content', 'newfile.ts');

    expect(result).toContain('+new content');
  });

  it('handles empty new content (full deletion)', () => {
    const result = generateUnifiedDiff('old content', '', 'deleted.ts');

    expect(result).toContain('-old content');
  });
});

describe('parseDiffLines', () => {
  it('parses unified diff format into line objects', () => {
    const diff = `--- /path/to/file.ts
+++ /path/to/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;

    const result = parseDiffLines(diff);

    expect(result).toEqual<DiffLine[]>([
      { type: 'header', content: '--- /path/to/file.ts', lineNumber: null },
      { type: 'header', content: '+++ /path/to/file.ts', lineNumber: null },
      { type: 'hunk', content: '@@ -1,3 +1,3 @@', lineNumber: null },
      { type: 'context', content: 'line1', lineNumber: 1 },
      { type: 'removal', content: 'old line', lineNumber: 2 },
      { type: 'addition', content: 'new line', lineNumber: 2 },
      { type: 'context', content: 'line3', lineNumber: 3 },
    ]);
  });

  it('handles multiple hunks', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,2 @@
-old1
+new1
@@ -10,2 +10,2 @@
-old2
+new2`;

    const result = parseDiffLines(diff);

    const hunkLines = result.filter((l) => l.type === 'hunk');
    expect(hunkLines).toHaveLength(2);
  });

  it('returns empty array for non-diff content', () => {
    const result = parseDiffLines('just some regular text\nno diff here');

    expect(result).toEqual([]);
  });

  it('handles empty input', () => {
    expect(parseDiffLines('')).toEqual([]);
  });

  it('extracts line numbers from hunk headers', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,4 @@
 context line
-removed
+added1
+added2`;

    const result = parseDiffLines(diff);

    // Context line at original line 5
    const contextLine = result.find((l) => l.type === 'context');
    expect(contextLine?.lineNumber).toBe(5);
  });
});
