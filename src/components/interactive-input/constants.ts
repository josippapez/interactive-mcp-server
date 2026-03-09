export const repositoryFileCache = new Map<string, string[]>();

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export const TEXT_EMBED_MAX_BYTES = 512 * 1024;
export const COLLAPSE_TEXT_PASTE_CHARS = 800;
export const COLLAPSE_TEXT_PASTE_LINES = 12;

export interface QueuedAttachment {
  id: string;
  label: string;
  payload: string;
}

export const shouldCollapsePastedText = (text: string): boolean =>
  text.length >= COLLAPSE_TEXT_PASTE_CHARS ||
  text.split(/\r?\n/).length >= COLLAPSE_TEXT_PASTE_LINES;
