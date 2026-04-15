import { Store } from '@tanstack/store';
import type {
  DeltaBuffer,
  PendingPartsBuffer,
  TextDelta,
} from '../hooks/delta-batcher-types';
import { accumulateDelta, deltaKey } from '../hooks/delta-batcher-core';
import type { ConversationMessagePart } from '../../../preload/index';

type ConversationStreamState = {
  deltaBuffer: DeltaBuffer;
  pendingParts: PendingPartsBuffer;
  staleDeltaKeys: Set<string>;
};

export interface ConversationStreamSnapshot {
  deltaBuffer: DeltaBuffer;
  pendingParts: PendingPartsBuffer;
}

function createInitialState(): ConversationStreamState {
  return {
    deltaBuffer: new Map(),
    pendingParts: new Map(),
    staleDeltaKeys: new Set(),
  };
}

export function createConversationStreamStore() {
  const store = new Store<ConversationStreamState>(createInitialState());

  const pushDelta = (delta: TextDelta) => {
    store.setState((prev) => {
      const key = deltaKey(delta.messageId, delta.partId);
      if (prev.staleDeltaKeys.has(key)) {
        return prev;
      }

      const nextBuffer = new Map(prev.deltaBuffer);
      accumulateDelta(nextBuffer, delta);
      return { ...prev, deltaBuffer: nextBuffer };
    });
  };

  const addPart = (
    sessionId: string,
    messageId: string,
    part: ConversationMessagePart,
  ) => {
    store.setState((prev) => {
      const key = deltaKey(messageId, part.id);
      const nextPendingParts = new Map(prev.pendingParts);
      nextPendingParts.set(key, { sessionId, messageId, part });

      const nextBuffer = new Map(prev.deltaBuffer);
      nextBuffer.delete(key);

      const nextStaleKeys = new Set(prev.staleDeltaKeys);
      nextStaleKeys.add(key);

      return {
        deltaBuffer: nextBuffer,
        pendingParts: nextPendingParts,
        staleDeltaKeys: nextStaleKeys,
      };
    });
  };

  const getSnapshotAndClear = (): ConversationStreamSnapshot => {
    const current = store.state;
    const snapshot = {
      deltaBuffer: new Map(current.deltaBuffer),
      pendingParts: new Map(current.pendingParts),
    };

    store.setState(createInitialState());
    return snapshot;
  };

  const hasPendingWork = () => {
    const current = store.state;
    return current.deltaBuffer.size > 0 || current.pendingParts.size > 0;
  };

  const reset = () => {
    store.setState(createInitialState());
  };

  return {
    store,
    pushDelta,
    addPart,
    getSnapshotAndClear,
    hasPendingWork,
    reset,
  };
}
