import { saveAttachment, attachmentUrl } from './attachment-store';

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
  noReply: boolean = false,
  mcpServerPort?: number,
): Promise<{ ok: boolean; error?: string; noReply?: boolean }> {
  const url = `http://localhost:${openCodePort}/session/${encodeURIComponent(openCodeSessionId)}/message`;

  // Build the full message text: start with the user's message, then append
  // attachment references. Images are saved to persistent storage and
  // referenced by URL (served via the MCP server). Text files are inlined.
  let fullText = message;
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith('image/')) {
      // Save image to persistent attachment store and reference by URL
      const filename = saveAttachment(att.data, att.mimeType);
      if (filename && mcpServerPort) {
        const imageUrl = attachmentUrl(filename, mcpServerPort);
        fullText += `\n\n[Image: ${att.name}](${imageUrl})`;
      } else if (filename) {
        // Fallback: reference the file by name (no port available)
        fullText += `\n\n[Image attached: ${att.name}]`;
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
      body: JSON.stringify({ noReply, parts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `OpenCode API returned ${res.status}: ${body}`,
        noReply,
      };
    }
    return { ok: true, noReply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, noReply };
  }
}
