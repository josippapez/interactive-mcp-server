import type React from 'react';
import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/index';
import type { createDeltaBatcher } from './delta-batcher';
import {
  DUPLICATE_EVENT_WINDOW_MS,
  getMessageEventKey,
  getMessageEventReconcileDelay,
  shouldReconcileMessageEvent,
} from './useConversation-pacing';

type MessageEvent = {
  type:
    | 'message.created'
    | 'message.updated'
    | 'message.completed'
    | 'message.removed';
  sessionId: string;
  messageId?: string;
};

type PartEvent = {
  type: 'part.added' | 'part.updated' | 'part.removed';
  sessionId: string;
  messageId?: string;
  part?: ConversationMessagePart;
  partId?: string;
};

type PartDeltaEvent = {
  type: 'part.delta';
  sessionId: string;
  messageId: string;
  partId: string;
  deltaField: string;
  deltaValue: string;
};

type Batcher = ReturnType<typeof createDeltaBatcher>;

export function createMessageEventHandler(args: {
  openCodeSessionId: string;
  lastSseEventRef: React.MutableRefObject<number>;
  lastDeltaAtRef: React.MutableRefObject<number>;
  lastMessageEventRef: React.MutableRefObject<{
    key: string;
    timestamp: number;
  } | null>;
  clearReconcileTimer: () => void;
  batcher: Batcher;
  fetchMessages: () => Promise<void>;
  setMessagesAndCache: React.Dispatch<
    React.SetStateAction<ConversationMessage[]>
  >;
  scheduleReconcileFetch: (delayMs: number, flush: () => void) => void;
}) {
  return (data: MessageEvent) => {
    if (data.sessionId !== args.openCodeSessionId) return;

    const now = Date.now();
    args.lastSseEventRef.current = now;

    const eventKey = getMessageEventKey(
      data.type,
      data.sessionId,
      data.messageId,
    );
    const lastEvent = args.lastMessageEventRef.current;
    if (
      lastEvent &&
      lastEvent.key === eventKey &&
      now - lastEvent.timestamp < DUPLICATE_EVENT_WINDOW_MS
    ) {
      return;
    }

    args.lastMessageEventRef.current = { key: eventKey, timestamp: now };

    if (
      !shouldReconcileMessageEvent(data.type, args.lastDeltaAtRef.current, now)
    ) {
      return;
    }

    if (data.type === 'message.removed' && data.messageId) {
      args.clearReconcileTimer();
      args.batcher.flush();
      args.setMessagesAndCache((prev) =>
        prev.filter((message) => message.id !== data.messageId),
      );
      return;
    }

    if (data.type === 'message.completed') {
      args.clearReconcileTimer();
      args.batcher.flush();
      void args.fetchMessages();
      return;
    }

    args.scheduleReconcileFetch(
      getMessageEventReconcileDelay(
        data.type,
        args.lastDeltaAtRef.current,
        now,
      ),
      args.batcher.flush,
    );
  };
}

export function createPartEventHandler(args: {
  openCodeSessionId: string;
  lastSseEventRef: React.MutableRefObject<number>;
  batcher: Batcher;
  setMessagesAndCache: React.Dispatch<
    React.SetStateAction<ConversationMessage[]>
  >;
}) {
  return (data: PartEvent) => {
    if (data.sessionId !== args.openCodeSessionId) return;
    args.lastSseEventRef.current = Date.now();

    if (data.type === 'part.removed' && data.partId) {
      args.batcher.flush();
      args.setMessagesAndCache((prev) =>
        prev.map((message) => {
          if (data.messageId && message.id !== data.messageId) {
            return message;
          }

          const nextParts = message.parts.filter(
            (part) => part.id !== data.partId,
          );
          if (nextParts.length === message.parts.length) {
            return message;
          }

          return { ...message, parts: nextParts };
        }),
      );
      return;
    }

    if (data.part && data.messageId) {
      args.batcher.addPart(data.sessionId, data.messageId, data.part);
      if (data.part.type !== 'text' && data.part.type !== 'reasoning') {
        args.batcher.flush();
      }
    }
  };
}

export function createPartDeltaHandler(args: {
  openCodeSessionId: string;
  lastSseEventRef: React.MutableRefObject<number>;
  lastDeltaAtRef: React.MutableRefObject<number>;
  batcher: Batcher;
}) {
  return (data: PartDeltaEvent) => {
    if (data.sessionId !== args.openCodeSessionId) return;

    const now = Date.now();
    args.lastSseEventRef.current = now;
    args.lastDeltaAtRef.current = now;

    if (data.deltaField === 'text') {
      args.batcher.push({
        sessionId: data.sessionId,
        messageId: data.messageId,
        partId: data.partId,
        text: data.deltaValue,
      });
    }
  };
}

export function createCompactedHandler(args: {
  openCodeSessionId: string;
  lastSseEventRef: React.MutableRefObject<number>;
  clearReconcileTimer: () => void;
  batcher: Batcher;
  fetchMessages: () => Promise<void>;
}) {
  return (data: { sessionId: string }) => {
    if (data.sessionId !== args.openCodeSessionId) return;
    args.lastSseEventRef.current = Date.now();
    args.clearReconcileTimer();
    args.batcher.flush();
    void args.fetchMessages();
  };
}
