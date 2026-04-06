import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'fs';
import { tmpdir } from 'os';

// Create a unique test directory
const TEST_DIR = join(tmpdir(), `imcp-attachment-store-test-${process.pid}`);
const FAKE_ATTACHMENTS_DIR = join(TEST_DIR, 'attachments');

// Mock electron app.getPath to return our test directory
vi.mock('electron', () => ({
  app: {
    getPath: () => TEST_DIR,
  },
}));

import {
  saveAttachment,
  resolveAttachmentPath,
  attachmentUrl,
  cleanupOldAttachments,
  getAttachmentsDir,
} from '../main/attachment-store';

describe('attachment-store', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('getAttachmentsDir', () => {
    it('returns a path under userData/attachments', () => {
      const dir = getAttachmentsDir();
      expect(dir).toBe(FAKE_ATTACHMENTS_DIR);
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe('saveAttachment', () => {
    it('saves a base64-encoded image and returns the filename', () => {
      // 1x1 red PNG pixel
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

      const filename = saveAttachment(pngBase64, 'image/png');
      expect(filename).not.toBeNull();
      expect(filename!).toMatch(/^[0-9a-f-]+\.png$/);

      // Verify the file exists and contains valid PNG data
      const filePath = join(FAKE_ATTACHMENTS_DIR, filename!);
      expect(existsSync(filePath)).toBe(true);
      const data = readFileSync(filePath);
      // PNG magic bytes
      expect(data[0]).toBe(0x89);
      expect(data[1]).toBe(0x50);
    });

    it('normalizes jpeg to jpg extension', () => {
      const filename = saveAttachment('dGVzdA==', 'image/jpeg');
      expect(filename).not.toBeNull();
      expect(filename!).toMatch(/\.jpg$/);
    });

    it('returns null on invalid data (non-critical failure)', () => {
      // This should not throw even if data is weird
      // In practice saveAttachment only fails if the write fails
      const filename = saveAttachment('', 'image/png');
      // Empty base64 is valid (0 bytes), so it should succeed
      expect(filename).not.toBeNull();
    });
  });

  describe('resolveAttachmentPath', () => {
    it('returns the full path for an existing attachment', () => {
      const filename = saveAttachment('dGVzdA==', 'image/png');
      const resolved = resolveAttachmentPath(filename!);
      expect(resolved).toBe(join(FAKE_ATTACHMENTS_DIR, filename!));
    });

    it('returns null for non-existent files', () => {
      const resolved = resolveAttachmentPath('nonexistent.png');
      expect(resolved).toBeNull();
    });

    it('rejects path traversal attempts', () => {
      expect(resolveAttachmentPath('../etc/passwd')).toBeNull();
      expect(resolveAttachmentPath('..\\windows\\system32')).toBeNull();
      expect(resolveAttachmentPath('..')).toBeNull();
    });
  });

  describe('attachmentUrl', () => {
    it('builds the correct URL', () => {
      const url = attachmentUrl('abc123.png', 3100);
      expect(url).toBe('http://localhost:3100/attachments/abc123.png');
    });

    it('encodes special characters in the filename', () => {
      const url = attachmentUrl('file with spaces.png', 3100);
      expect(url).toBe(
        'http://localhost:3100/attachments/file%20with%20spaces.png',
      );
    });
  });

  describe('cleanupOldAttachments', () => {
    it('removes files older than the max age', () => {
      // Create a file and backdate its mtime to 8 days ago
      const dir = getAttachmentsDir();
      const oldFile = join(dir, 'old-file.png');
      writeFileSync(oldFile, 'old data');
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

      // Create a recent file
      const newFile = join(dir, 'new-file.png');
      writeFileSync(newFile, 'new data');

      const removed = cleanupOldAttachments();
      expect(removed).toBe(1);
      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(newFile)).toBe(true);
    });

    it('returns 0 when no files are old enough', () => {
      const dir = getAttachmentsDir();
      writeFileSync(join(dir, 'recent.png'), 'data');

      const removed = cleanupOldAttachments();
      expect(removed).toBe(0);
    });
  });
});
