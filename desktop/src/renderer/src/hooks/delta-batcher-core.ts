import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/index';
import type {
  DeltaBuffer,
  PartType,
  PendingPart,
  PendingPartsBuffer,
  TextDelta,
} from './delta-batcher-types';

export function deltaKey(messageId: string, partId: string): string {
  return `${messageId}:${partId}`;
}

export function accumulateDelta(
  buffer: DeltaBuffer,
  delta: TextDelta,
): DeltaBuffer {
  const key = deltaKey(delta.messageId, delta.partId);
  const existing = buffer.get(key);
  if (existing) {
    existing.text += delta.text;
    return buffer;
  }

  buffer.set(key, { ...delta });
  return buffer;
}

export function inferPartType(
  partId: string,
  text: string,
  pendingParts?: PendingPartsBuffer,
  messageId?: string,
): PartType {
  const normalizedPartId = partId.toLowerCase();

  if (pendingParts && messageId) {
    const key = deltaKey(messageId, partId);
    const pending = pendingParts.get(key);
    if (pending && pending.part.type && pending.part.type !== 'text') {
      return pending.part.type;
    }
  }

  if (
    normalizedPartId.includes('reasoning') ||
    normalizedPartId.includes('thinking')
  ) {
    return 'reasoning';
  }

  if (text.includes('<compaction>') || text.includes('</compaction>')) {
    return 'compaction';
  }

  return 'text';
}

function groupDeltasByMessage(
  buffer: DeltaBuffer,
): Map<string, Map<string, TextDelta>> {
  const byMessage = new Map<string, Map<string, TextDelta>>();
  for (const delta of buffer.values()) {
    const parts =
      byMessage.get(delta.messageId) ?? new Map<string, TextDelta>();
    parts.set(delta.partId, delta);
    byMessage.set(delta.messageId, parts);
  }

  return byMessage;
}

function groupPartsByMessage(
  pendingParts: PendingPartsBuffer,
): Map<string, Map<string, PendingPart>> {
  const byMessage = new Map<string, Map<string, PendingPart>>();
  for (const pending of pendingParts.values()) {
    const parts =
      byMessage.get(pending.messageId) ?? new Map<string, PendingPart>();
    parts.set(pending.part.id, pending);
    byMessage.set(pending.messageId, parts);
  }

  return byMessage;
}

export function applyDeltas(
  messages: ConversationMessage[],
  buffer: DeltaBuffer,
  pendingParts?: PendingPartsBuffer,
): ConversationMessage[] {
  if (buffer.size === 0) {
    return messages;
  }

  const byMessage = groupDeltasByMessage(buffer);
  let changed = false;
  let result = messages;

  for (const [messageId, partDeltas] of byMessage) {
    const msgIndex = result.findIndex((message) => message.id === messageId);
    if (msgIndex === -1) {
      continue;
    }

    const message = result[msgIndex];
    let partsChanged = false;
    let newParts = message.parts;

    for (const [partId, delta] of partDeltas) {
      const partIndex = newParts.findIndex((part) => part.id === partId);
      if (partIndex === -1) {
        const partType = inferPartType(
          partId,
          delta.text,
          pendingParts,
          messageId,
        );
        if (!partsChanged) {
          newParts = [...newParts];
          partsChanged = true;
        }
        newParts.push({ id: partId, type: partType, text: delta.text });
        continue;
      }

      const part = newParts[partIndex];
      const newText = (part.text ?? '') + delta.text;
      const newType =
        part.type !== 'text'
          ? part.type
          : inferPartType(partId, newText, pendingParts, messageId);

      if (!partsChanged) {
        newParts = [...newParts];
        partsChanged = true;
      }
      newParts[partIndex] = { ...part, type: newType, text: newText };
    }

    if (!partsChanged) {
      continue;
    }

    if (!changed) {
      result = [...result];
      changed = true;
    }

    const isCompaction = newParts.some((part) => part.type === 'compaction');
    const updatedMessage: ConversationMessage = { ...message, parts: newParts };
    if (isCompaction && !message.mode) {
      updatedMessage.mode = 'compaction';
    }
    result[msgIndex] = updatedMessage;
  }

  return result;
}

export function applyPendingParts(
  messages: ConversationMessage[],
  pendingParts: PendingPartsBuffer,
): ConversationMessage[] {
  if (pendingParts.size === 0) {
    return messages;
  }

  const byMessage = groupPartsByMessage(pendingParts);
  let changed = false;
  let result = messages;

  for (const [messageId, partMap] of byMessage) {
    const msgIndex = result.findIndex((message) => message.id === messageId);
    if (msgIndex === -1) {
      continue;
    }

    const message = result[msgIndex];
    let partsChanged = false;
    let newParts = message.parts;

    for (const [partId, pending] of partMap) {
      const partIndex = newParts.findIndex((part) => part.id === partId);
      if (partIndex === -1) {
        if (!partsChanged) {
          newParts = [...newParts];
          partsChanged = true;
        }
        newParts.push(pending.part);
        continue;
      }

      const existingPart = newParts[partIndex];
      const existingText = existingPart.text ?? '';
      const newText = pending.part.text ?? '';
      if (newText.length < existingText.length) {
        continue;
      }

      if (!partsChanged) {
        newParts = [...newParts];
        partsChanged = true;
      }
      newParts[partIndex] = pending.part;
    }

    if (!partsChanged) {
      continue;
    }

    if (!changed) {
      result = [...result];
      changed = true;
    }
    result[msgIndex] = { ...message, parts: newParts };
  }

  return result;
}

export function applyBufferedConversationUpdates(
  messages: ConversationMessage[],
  deltaBuffer: DeltaBuffer,
  pendingParts: PendingPartsBuffer,
): ConversationMessage[] {
  let result = messages;
  if (deltaBuffer.size > 0) {
    result = applyDeltas(result, deltaBuffer, pendingParts);
  }
  if (pendingParts.size > 0) {
    result = applyPendingParts(result, pendingParts);
  }
  return result;
}
