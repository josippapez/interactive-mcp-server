import type { ChannelMessage } from '../types';

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function parseHistoryTimestamp(value: string): Date {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(
    normalized.endsWith('Z') ? normalized : `${normalized}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseAttachments(
  raw: string | null,
):
  | { data: string; mimeType: string; name: string; size: number }[]
  | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(Boolean) as {
      data: string;
      mimeType: string;
      name: string;
      size: number;
    }[];
  } catch {
    return undefined;
  }
}

function toChannelMessage(record: {
  id: number;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
}): ChannelMessage {
  return {
    id: `db-${record.id}`,
    kind: record.messageType,
    text: record.messageText,
    timestamp: parseHistoryTimestamp(record.createdAt),
    attachments: parseAttachments(record.attachments),
    sent: record.messageType === 'outbound' ? true : undefined,
  };
}

function getMessageSignature(message: ChannelMessage): string {
  const attachmentSignature = (message.attachments ?? [])
    .map((attachment) =>
      [
        attachment.name,
        attachment.mimeType,
        attachment.size ?? '',
        attachment.data.length,
      ].join(':'),
    )
    .join(',');

  return [message.kind, message.text, attachmentSignature].join('|');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns a `loadHistory` function that fetches persisted messages for a
 * session from the main process and merges them with any live messages already
 * in the `ConnectionState`.
 *
 * The caller is responsible for writing the merged result back to state.
 */
export function useChannelHistory(): {
  loadHistory: (
    connectionId: string,
    liveMessages: ChannelMessage[],
  ) => Promise<ChannelMessage[]>;
} {
  const loadHistory = async (
    connectionId: string,
    liveMessages: ChannelMessage[],
  ): Promise<ChannelMessage[]> => {
    const records = await window.api.getSessionChannelHistory?.(connectionId);
    if (!records) return liveMessages;

    const dbMessages = records.map(toChannelMessage);
    // Merge: keep live messages that are not already covered by a DB record.
    // Persisted DB history is authoritative for completed outbound messages.
    const liveIds = new Set(dbMessages.map(getMessageSignature));
    const dedupedLive = liveMessages.filter(
      (m) => !liveIds.has(getMessageSignature(m)),
    );
    return [...dbMessages, ...dedupedLive].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  };

  return { loadHistory };
}
