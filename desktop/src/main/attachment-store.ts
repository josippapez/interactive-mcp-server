/**
 * Ephemeral attachment storage (tmpdir, per-session subfolder).
 *
 * Saves image attachments to
 *   `<os.tmpdir()>/interactive-mcp-<sessionKey>/<uuid>.<ext>`
 * so they live alongside the CLI package's pasted-image files and get wiped
 * automatically on OS reboot. Served via HTTP at
 *   `/attachments/<sessionKey>/<filename>`
 *
 * `sessionKey` is the OpenCode session id when available, otherwise the MCP
 * connectionId (for non-OpenCode providers such as Copilot CLI / Claude SDK).
 */

import { tmpdir } from 'os';
import { basename, join } from 'path';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { randomUUID } from 'crypto';

/** Maximum age (ms) for attachment files before they are cleaned up. Default: 7 days. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sanitize a session key so it's safe as a directory name. We accept the
 * OpenCode session id shape (`ses_<alnum>`) and generic connectionIds; reject
 * anything that could traverse the path.
 */
function sanitizeSessionKey(sessionKey: string): string | null {
  if (!sessionKey) return null;
  // Only allow [A-Za-z0-9_-]; anything else is rejected (prevents path traversal).
  if (!/^[A-Za-z0-9_-]+$/.test(sessionKey)) return null;
  return sessionKey;
}

function sessionDir(sessionKey: string): string | null {
  const safe = sanitizeSessionKey(sessionKey);
  if (!safe) return null;
  return join(tmpdir(), `interactive-mcp-${safe}`);
}

function ensureSessionDir(sessionKey: string): string | null {
  const dir = sessionDir(sessionKey);
  if (!dir) return null;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Return the attachments directory for a given session (creates it if needed).
 * Returns null if sessionKey is missing/invalid.
 */
export function getAttachmentsDir(sessionKey: string): string | null {
  return ensureSessionDir(sessionKey);
}

/**
 * Save a base64-encoded image attachment to disk, namespaced by session.
 * Returns the filename (e.g. `abc123.png`) — not the full path.
 */
export function saveAttachment(
  sessionKey: string,
  base64Data: string,
  mimeType: string,
): string | null {
  try {
    const dir = ensureSessionDir(sessionKey);
    if (!dir) return null;
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
 * Save attachment content to disk under its original filename (prefixed with a
 * UUID for uniqueness). Supports either utf-8 text or base64-encoded content.
 */
export function saveNamedAttachment(
  sessionKey: string,
  originalName: string,
  data: string,
  encoding: BufferEncoding = 'utf8',
): string | null {
  try {
    const dir = ensureSessionDir(sessionKey);
    if (!dir) return null;

    const safeName = basename(originalName || 'attachment.bin');
    const filename = `${randomUUID()}-${safeName}`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, Buffer.from(data, encoding));
    return filename;
  } catch {
    return null;
  }
}

/**
 * Resolve a (sessionKey, filename) pair to its absolute path. Returns null
 * on path traversal, missing session, or missing file.
 */
export function resolveAttachmentPath(
  sessionKey: string,
  filename: string,
): string | null {
  const dir = sessionDir(sessionKey);
  if (!dir) return null;
  if (filename.includes('/') || filename.includes('\\') || filename === '..') {
    return null;
  }
  const filePath = join(dir, filename);
  return existsSync(filePath) ? filePath : null;
}

/**
 * Build the public URL for an attachment served via the MCP server.
 */
export function attachmentUrl(
  sessionKey: string,
  filename: string,
  port: number,
): string {
  return `http://localhost:${port}/attachments/${encodeURIComponent(
    sessionKey,
  )}/${encodeURIComponent(filename)}`;
}

/**
 * Remove all attachment files for a single session. Called when a session is
 * closed/deleted so images don't linger.
 */
export function clearSessionAttachments(sessionKey: string): void {
  const dir = sessionDir(sessionKey);
  if (!dir || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Clean up old session directories that exceed MAX_AGE_MS (fallback for the
 * case where a session was never explicitly closed). Scans `tmpdir()` for
 * `interactive-mcp-*` folders.
 */
export function cleanupOldAttachments(): number {
  let removed = 0;
  const base = tmpdir();
  const now = Date.now();
  try {
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith('interactive-mcp-')) continue;
      const dir = join(base, entry);
      try {
        const stat = statSync(dir);
        if (!stat.isDirectory()) continue;
        if (now - stat.mtimeMs <= MAX_AGE_MS) continue;
        // Remove files individually first, then the dir, so partial failures
        // still reclaim space.
        try {
          for (const file of readdirSync(dir)) {
            try {
              unlinkSync(join(dir, file));
              removed++;
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      } catch {
        // ignore individual dir errors
      }
    }
  } catch {
    // ignore base read errors
  }
  return removed;
}
