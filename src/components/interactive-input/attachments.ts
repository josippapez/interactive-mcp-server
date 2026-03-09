import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  IMAGE_MIME_BY_EXTENSION,
  TEXT_EMBED_MAX_BYTES,
  type QueuedAttachment,
} from './constants.js';

export const normalizeClipboardPath = (
  clipboardText: string,
  searchRoot?: string,
): string | null => {
  const trimmed = clipboardText.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let candidate = lines[0] ?? '';
  if (!candidate) {
    return null;
  }
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1);
  }

  if (candidate.startsWith('file://')) {
    candidate = decodeURIComponent(candidate.replace(/^file:\/\//, ''));
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  if (!searchRoot) {
    return null;
  }

  return path.resolve(searchRoot, candidate);
};

const isLikelyTextBuffer = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspiciousBytes = 0;
  for (const byte of sample) {
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isExtendedUtf8Byte = byte >= 128;
    if (!isPrintableAscii && !isWhitespace && !isExtendedUtf8Byte) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes < 8;
};

export const buildAttachmentFromPath = async (
  absolutePath: string,
): Promise<QueuedAttachment> => {
  const fileStats = await fs.stat(absolutePath);
  if (!fileStats.isFile()) {
    throw new Error('Clipboard path is not a file');
  }

  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const imageMimeType = IMAGE_MIME_BY_EXTENSION[extension];
  const sizeKB = Math.round(fileStats.size / 1024);

  if (imageMimeType) {
    return {
      id: crypto.randomUUID(),
      label: `Image: ${fileName} (${sizeKB}KB)`,
      payload: `[Image file: ${absolutePath}]`,
    };
  }

  const fileBuffer = await fs.readFile(absolutePath);
  const isTextFile =
    fileStats.size <= TEXT_EMBED_MAX_BYTES && isLikelyTextBuffer(fileBuffer);

  if (isTextFile) {
    return {
      id: crypto.randomUUID(),
      label: `File: ${fileName} (${sizeKB}KB text)`,
      payload: `[Text file: ${absolutePath}]`,
    };
  }

  return {
    id: crypto.randomUUID(),
    label: `File: ${fileName} (${sizeKB}KB binary)`,
    payload: `[Binary file: ${absolutePath}]`,
  };
};
