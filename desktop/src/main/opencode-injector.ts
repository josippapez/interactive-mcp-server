import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const SUPPORTED_FILE_EXTENSIONS: string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'txt',
  'md',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'yml',
  'yaml',
  'toml',
  'xml',
  'csv',
  'log',
  'sh',
  'bash',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
];

export interface Attachment {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

export async function injectOpenCodeMessage(
  openCodeSessionId: string,
  message: string,
  attachments: Attachment[] | undefined,
  openCodePort: number,
): Promise<{ ok: boolean; error?: string }> {
  const url = `http://localhost:${openCodePort}/session/${encodeURIComponent(openCodeSessionId)}/message`;

  // Build the full message text: start with the user's message, then append
  // attachment references as file paths (images saved to temp, text inlined).
  let fullText = message;
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith('image/')) {
      // Save image to a temp file and reference by path
      const ext = att.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const tempPath = join(tmpdir(), `imcp-attachment-${randomUUID()}.${ext}`);
      try {
        writeFileSync(tempPath, Buffer.from(att.data, 'base64'));
        fullText += `\n\n[Image file: ${tempPath}]`;
      } catch {
        // If we can't write the temp file, skip this attachment
      }
    } else {
      // Text file: inline the content
      fullText += `\n\n--- File: ${att.name} ---\n${att.data}`;
    }
  }

  const parts: { type: 'text'; text: string }[] = [
    { type: 'text', text: fullText },
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noReply: true, parts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `OpenCode API returned ${res.status}: ${body}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
