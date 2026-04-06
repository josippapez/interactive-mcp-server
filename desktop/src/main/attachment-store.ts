/**
 * Persistent attachment storage.
 *
 * Saves image attachments to `<userData>/attachments/<uuid>.<ext>` so they
 * survive app restarts and can be served via HTTP to agents.
 *
 * The attachments directory is lazily created on first write.
 */

import { app } from 'electron';
import { join } from 'path';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { randomUUID } from 'crypto';

let attachmentsDir: string | null = null;

/** Maximum age (ms) for attachment files before they are cleaned up. Default: 7 days. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir(): string {
  if (!attachmentsDir) {
    attachmentsDir = join(app.getPath('userData'), 'attachments');
  }
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true });
  }
  return attachmentsDir;
}

/**
 * Return the base attachments directory path (creates it if needed).
 */
export function getAttachmentsDir(): string {
  return ensureDir();
}

/**
 * Save a base64-encoded image attachment to disk.
 * Returns the filename (e.g. `abc123.png`) — not the full path.
 */
export function saveAttachment(
  base64Data: string,
  mimeType: string,
): string | null {
  try {
    const dir = ensureDir();
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return filename;
  } catch {
    return null;
  }
}

/**
 * Resolve a filename to its full path in the attachments directory.
 * Returns null if the file doesn't exist.
 */
export function resolveAttachmentPath(filename: string): string | null {
  const dir = ensureDir();
  // Sanitize: only allow simple filenames (no path traversal)
  if (filename.includes('/') || filename.includes('\\') || filename === '..') {
    return null;
  }
  const filePath = join(dir, filename);
  return existsSync(filePath) ? filePath : null;
}

/**
 * Build the public URL for an attachment served via the MCP server.
 */
export function attachmentUrl(filename: string, port: number): string {
  return `http://localhost:${port}/attachments/${encodeURIComponent(filename)}`;
}

/**
 * Clean up old attachment files that exceed MAX_AGE_MS.
 * Called periodically to prevent unbounded disk usage.
 */
export function cleanupOldAttachments(): number {
  const dir = ensureDir();
  let removed = 0;
  const now = Date.now();
  try {
    for (const file of readdirSync(dir)) {
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore directory read errors
  }
  return removed;
}
