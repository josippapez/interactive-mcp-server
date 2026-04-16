import type React from 'react';
import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/index';
import { applyBufferedConversationUpdates } from './delta-batcher-core';
import { createDeltaBatcherScheduler } from './delta-batcher-scheduler';
import type { TextDelta } from './delta-batcher-types';
import { createConversationStreamStore } from '../store/conversation-stream-store';

const PACE_MS = 24;

export type {
  TextDelta,
  PendingPart,
  DeltaBuffer,
  PendingPartsBuffer,
  PartType,
} from './delta-batcher-types';
export {
  deltaKey,
  accumulateDelta,
  inferPartType,
  applyDeltas,
  applyPendingParts,
} from './delta-batcher-core';

export function createDeltaBatcher(
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>,
  options?: {
    paceMs?: number;
  },
): {
  push: (delta: TextDelta) => void;
  addPart: (
    sessionId: string,
    messageId: string,
    part: ConversationMessagePart,
  ) => void;
  dispose: () => void;
  flush: () => void;
} {
  const streamStore = createConversationStreamStore();
  const paceMs = options?.paceMs ?? PACE_MS;

  const applyBufferedUpdates = () => {
    const snapshot = streamStore.getSnapshotAndClear();
    if (snapshot.deltaBuffer.size === 0 && snapshot.pendingParts.size === 0) {
      return;
    }

    setMessages((prev) =>
      applyBufferedConversationUpdates(
        prev,
        snapshot.deltaBuffer,
        snapshot.pendingParts,
      ),
    );
  };

  const scheduler = createDeltaBatcherScheduler(applyBufferedUpdates, paceMs);

  const flush = () => {
    scheduler.cancel();
    applyBufferedUpdates();
  };

  return {
    push: (delta) => {
      streamStore.pushDelta(delta);
      scheduler.schedule();
    },
    addPart: (sessionId, messageId, part) => {
      streamStore.addPart(sessionId, messageId, part);
      scheduler.schedule();
    },
    dispose: () => {
      scheduler.cancel();
      if (streamStore.hasPendingWork()) {
        applyBufferedUpdates();
      }
      streamStore.reset();
    },
    flush,
  };
}
