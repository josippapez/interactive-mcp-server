import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/api/types';
import type {
  ConversationSessionStatus,
  ConversationState,
} from '../store/conversation-reducer';

const EMPTY_MESSAGES: ConversationMessage[] = [];
const EMPTY_PARTS: ConversationMessagePart[] = [];

export type SessionSnapshot = {
  messages: ConversationMessage[];
  status: ConversationSessionStatus;
};

const snapshotCache = new Map<
  string,
  {
    messages: ConversationMessage[];
    partsByMessageId: Map<string, ConversationMessagePart[]>;
    status: ConversationSessionStatus;
    joined: SessionSnapshot;
  }
>();
const snapshotCacheOrder: string[] = [];
export const SNAPSHOT_CACHE_MAX = 50;

function setSnapshotCache(
  sessionId: string,
  entry: NonNullable<ReturnType<typeof snapshotCache.get>>,
): void {
  snapshotCache.set(sessionId, entry);
  const existingIndex = snapshotCacheOrder.indexOf(sessionId);
  if (existingIndex !== -1) snapshotCacheOrder.splice(existingIndex, 1);
  snapshotCacheOrder.push(sessionId);
  while (snapshotCacheOrder.length > SNAPSHOT_CACHE_MAX) {
    const evicted = snapshotCacheOrder.shift();
    if (evicted) snapshotCache.delete(evicted);
  }
}

function messagePartsUnchanged(
  messages: readonly ConversationMessage[],
  partsByMessageId: ReadonlyMap<string, ConversationMessagePart[]>,
  stateParts: Record<string, ConversationMessagePart[]>,
): boolean {
  for (const msg of messages) {
    if ((stateParts[msg.id] ?? EMPTY_PARTS) !== partsByMessageId.get(msg.id)) {
      return false;
    }
  }
  return true;
}

export function shallowEqualMessage(
  a: ConversationMessage,
  b: ConversationMessage,
): boolean {
  return (
    a.id === b.id &&
    a.sessionId === b.sessionId &&
    a.role === b.role &&
    a.modelId === b.modelId &&
    a.providerId === b.providerId &&
    a.completedAt === b.completedAt &&
    a.mode === b.mode &&
    a.agent === b.agent &&
    a.variant === b.variant
  );
}

export function selectSession(
  state: ConversationState,
  sessionId: string,
): SessionSnapshot {
  const rawMessages = state.messages[sessionId] ?? EMPTY_MESSAGES;
  const status: ConversationSessionStatus = state.status[sessionId] ?? 'idle';

  const cached = snapshotCache.get(sessionId);
  if (
    cached &&
    cached.messages === rawMessages &&
    cached.status === status &&
    messagePartsUnchanged(rawMessages, cached.partsByMessageId, state.parts)
  ) {
    return cached.joined;
  }

  const prevJoinedById =
    cached && cached.joined.messages.length > 0
      ? new Map(cached.joined.messages.map((m) => [m.id, m]))
      : null;
  const joined: ConversationMessage[] = [];
  const partsByMessageId = new Map<string, ConversationMessagePart[]>();
  for (const msg of rawMessages) {
    const partList = state.parts[msg.id] ?? EMPTY_PARTS;
    partsByMessageId.set(msg.id, partList);
    const prevJoined = prevJoinedById?.get(msg.id);
    if (
      prevJoined &&
      prevJoined.parts === partList &&
      shallowEqualMessage(prevJoined, msg)
    ) {
      joined.push(prevJoined);
    } else {
      joined.push({ ...msg, parts: partList as ConversationMessagePart[] });
    }
  }

  const snapshot: SessionSnapshot = { messages: joined, status };
  setSnapshotCache(sessionId, {
    messages: rawMessages,
    partsByMessageId,
    status,
    joined: snapshot,
  });
  return snapshot;
}

export function snapshotsEqual(
  a: SessionSnapshot,
  b: SessionSnapshot,
): boolean {
  return a.messages === b.messages && a.status === b.status;
}

export const NULL_SNAPSHOT: SessionSnapshot = {
  messages: EMPTY_MESSAGES,
  status: 'idle',
};

export function clearSnapshotCache(): void {
  snapshotCache.clear();
  snapshotCacheOrder.splice(0, snapshotCacheOrder.length);
}

export function clearSessionSnapshotCache(sessionId: string): void {
  snapshotCache.delete(sessionId);
  const index = snapshotCacheOrder.indexOf(sessionId);
  if (index !== -1) snapshotCacheOrder.splice(index, 1);
}

export function getSnapshotCacheSizeForTests(): number {
  return snapshotCache.size;
}
