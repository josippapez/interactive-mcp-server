import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  utimesSync,
  readdirSync,
} from 'fs';
import { tmpdir } from 'os';

import {
  saveAttachment,
  resolveAttachmentPath,
  attachmentUrl,
  cleanupOldAttachments,
  getAttachmentsDir,
  clearSessionAttachments,
} from '../main/attachment-store';

const TEST_SESSION_A = `imcp-test-a-${process.pid}`;
const TEST_SESSION_B = `imcp-test-b-${process.pid}`;

function sessionDirFor(sessionKey: string): string {
  return join(tmpdir(), `interactive-mcp-${sessionKey}`);
}

describe('attachment-store (tmpdir, per-session)', () => {
  beforeEach(() => {
    // Clean any leftovers from prior runs.
    for (const key of [TEST_SESSION_A, TEST_SESSION_B]) {
      try {
        rmSync(sessionDirFor(key), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  afterEach(() => {
    for (const key of [TEST_SESSION_A, TEST_SESSION_B]) {
      try {
        rmSync(sessionDirFor(key), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  describe('getAttachmentsDir', () => {
    it('returns a per-session path under os.tmpdir()', () => {
      const dir = getAttachmentsDir(TEST_SESSION_A);
      expect(dir).toBe(sessionDirFor(TEST_SESSION_A));
      expect(existsSync(dir!)).toBe(true);
    });

    it('returns null for invalid session keys (path traversal)', () => {
      expect(getAttachmentsDir('../evil')).toBeNull();
      expect(getAttachmentsDir('has/slash')).toBeNull();
      expect(getAttachmentsDir('')).toBeNull();
    });
  });

  describe('saveAttachment', () => {
    it('saves base64 image under the per-session dir and returns filename', () => {
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      const filename = saveAttachment(TEST_SESSION_A, pngBase64, 'image/png');
      expect(filename).not.toBeNull();
      expect(filename!).toMatch(/^[0-9a-f-]+\.png$/);
      const filePath = join(sessionDirFor(TEST_SESSION_A), filename!);
      expect(existsSync(filePath)).toBe(true);
      const data = readFileSync(filePath);
      expect(data[0]).toBe(0x89);
      expect(data[1]).toBe(0x50);
    });

    it('normalizes jpeg to jpg extension', () => {
      const filename = saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/jpeg');
      expect(filename).not.toBeNull();
      expect(filename!).toMatch(/\.jpg$/);
    });

    it('keeps attachments from different sessions isolated', () => {
      const a = saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      const b = saveAttachment(TEST_SESSION_B, 'dGVzdA==', 'image/png');
      expect(readdirSync(sessionDirFor(TEST_SESSION_A))).toEqual([a!]);
      expect(readdirSync(sessionDirFor(TEST_SESSION_B))).toEqual([b!]);
    });

    it('returns null for invalid session keys', () => {
      expect(saveAttachment('../evil', 'dGVzdA==', 'image/png')).toBeNull();
      expect(saveAttachment('', 'dGVzdA==', 'image/png')).toBeNull();
    });
  });

  describe('resolveAttachmentPath', () => {
    it('returns the full path for an existing attachment', () => {
      const filename = saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      const resolved = resolveAttachmentPath(TEST_SESSION_A, filename!);
      expect(resolved).toBe(join(sessionDirFor(TEST_SESSION_A), filename!));
    });

    it('returns null for non-existent files', () => {
      expect(
        resolveAttachmentPath(TEST_SESSION_A, 'nonexistent.png'),
      ).toBeNull();
    });

    it('rejects path traversal in filename', () => {
      expect(resolveAttachmentPath(TEST_SESSION_A, '../etc/passwd')).toBeNull();
      expect(
        resolveAttachmentPath(TEST_SESSION_A, '..\\windows\\system32'),
      ).toBeNull();
      expect(resolveAttachmentPath(TEST_SESSION_A, '..')).toBeNull();
    });

    it('rejects invalid session key', () => {
      expect(resolveAttachmentPath('../evil', 'x.png')).toBeNull();
    });

    it('does not resolve across sessions', () => {
      const filename = saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      expect(resolveAttachmentPath(TEST_SESSION_B, filename!)).toBeNull();
    });
  });

  describe('attachmentUrl', () => {
    it('builds the correct URL with sessionKey + filename', () => {
      const url = attachmentUrl('ses_abc', 'abc123.png', 3100);
      expect(url).toBe('http://localhost:3100/attachments/ses_abc/abc123.png');
    });

    it('encodes special characters in both segments', () => {
      const url = attachmentUrl('ses abc', 'file with spaces.png', 3100);
      expect(url).toBe(
        'http://localhost:3100/attachments/ses%20abc/file%20with%20spaces.png',
      );
    });
  });

  describe('clearSessionAttachments', () => {
    it('removes all files for the session', () => {
      saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      expect(existsSync(sessionDirFor(TEST_SESSION_A))).toBe(true);
      clearSessionAttachments(TEST_SESSION_A);
      expect(existsSync(sessionDirFor(TEST_SESSION_A))).toBe(false);
    });

    it('is a no-op for unknown / invalid sessionKey', () => {
      expect(() => clearSessionAttachments('')).not.toThrow();
      expect(() => clearSessionAttachments('../evil')).not.toThrow();
    });

    it('does not touch other sessions', () => {
      saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      saveAttachment(TEST_SESSION_B, 'dGVzdA==', 'image/png');
      clearSessionAttachments(TEST_SESSION_A);
      expect(existsSync(sessionDirFor(TEST_SESSION_B))).toBe(true);
    });
  });

  describe('cleanupOldAttachments', () => {
    it('removes session dirs whose mtime is older than the max age', () => {
      const dir = getAttachmentsDir(TEST_SESSION_A);
      expect(dir).not.toBeNull();
      const oldFile = join(dir!, 'old.png');
      writeFileSync(oldFile, 'old');
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      // Backdate both file and directory.
      utimesSync(oldFile, eightDaysAgo, eightDaysAgo);
      utimesSync(dir!, eightDaysAgo, eightDaysAgo);

      // A recent session should be preserved.
      saveAttachment(TEST_SESSION_B, 'dGVzdA==', 'image/png');

      const removed = cleanupOldAttachments();
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(existsSync(dir!)).toBe(false);
      expect(existsSync(sessionDirFor(TEST_SESSION_B))).toBe(true);
    });

    it('returns 0 when nothing is old', () => {
      saveAttachment(TEST_SESSION_A, 'dGVzdA==', 'image/png');
      const removed = cleanupOldAttachments();
      expect(removed).toBe(0);
    });
  });
});
