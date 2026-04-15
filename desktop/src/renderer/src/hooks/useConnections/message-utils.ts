import type { Attachment, ChannelMessage } from '../../types';

interface DbMessageRecord {
  id: number;
  messageType: string;
  messageText: string;
  createdAt: string;
  attachments?: string | null;
}

/**
 * Parse a database message record into a ChannelMessage.
 */
export function parseDbMessage(r: DbMessageRecord): ChannelMessage {
  return {
    id: `db-${r.id}`,
    kind: r.messageType as ChannelMessage['kind'],
    text: r.messageText,
    timestamp: parseTimestamp(r.createdAt),
    attachments: parseAttachments(r.attachments),
  };
}

function parseTimestamp(v: string): Date {
  const normalized = v.includes('T') ? v : v.replace(' ', 'T');
  const parsed = new Date(
    normalized.endsWith('Z') ? normalized : `${normalized}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseAttachments(
  attachments: string | null | undefined,
): Attachment[] | undefined {
  if (!attachments) return undefined;
  try {
    return JSON.parse(attachments) as Attachment[];
  } catch {
    return undefined;
  }
}

/**
 * Merge DB messages with live messages, deduplicating and sorting by timestamp.
 */
export function mergeMessages(
  dbMessages: ChannelMessage[],
  liveMessages: ChannelMessage[],
): ChannelMessage[] {
  const liveIds = new Set(dbMessages.map((m) => `${m.kind}::${m.text}`));
  const dedupedLive = liveMessages.filter(
    (m) => !liveIds.has(`${m.kind}::${m.text}`),
  );
  return [...dbMessages, ...dedupedLive].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}
