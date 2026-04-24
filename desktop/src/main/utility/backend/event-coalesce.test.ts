/**
 * event-coalesce.test.ts — regression tests for the streaming coalescer.
 *
 * Bug (fixed): the first delta(s) of a streaming assistant message were
 * dropped in the UI. Root cause: the enqueue path added a partId to
 * `staleDeltas` on EVERY `message.part.updated` event. The very first
 * whole-part event for a new streaming part carries `text: ""`, so
 * marking its partId stale caused subsequent deltas (which carry the
 * first actual characters) to be filtered out at flush.
 *
 * These tests are pure — no Electron, no IPC, no timers.
 *
 * Test runner: vitest (or any Jest-compatible runner). The assertions
 * use only `expect().toEqual/.toBe` so they also run under Node's
 * built-in `node:test` runner with a minimal shim.
 */

import { describe, expect, it } from 'vitest';
import type {
  ConversationEvent,
  ConversationMessagePart,
} from '../../../preload/api/types';
import {
  createCoalesceState,
  drainFlush,
  enqueueEvent,
} from './event-coalesce';

function textPart(id: string, text: string): ConversationMessagePart {
  return { id, type: 'text', text };
}

function partUpdated(
  sessionId: string,
  messageId: string,
  part: ConversationMessagePart,
): ConversationEvent {
  return {
    type: 'message.part.updated',
    sessionId,
    messageId,
    part,
  };
}

function partDelta(
  sessionId: string,
  messageId: string,
  partId: string,
  delta: string,
): ConversationEvent {
  return {
    type: 'message.part.delta',
    sessionId,
    messageId,
    partId,
    field: 'text',
    delta,
  };
}

describe('event-coalesce — first-delta regression', () => {
  it('preserves deltas that arrive after a FIRST whole-part event in the same tick', () => {
    const s = createCoalesceState();

    // Simulate the SSE order observed at the start of an assistant turn:
    //   1. message.part.updated (new text part, empty text)
    //   2. message.part.delta ("Hel")
    //   3. message.part.delta ("lo")
    enqueueEvent(s, partUpdated('sess1', 'msg1', textPart('p1', '')));
    enqueueEvent(s, partDelta('sess1', 'msg1', 'p1', 'Hel'));
    enqueueEvent(s, partDelta('sess1', 'msg1', 'p1', 'lo'));

    const flushed = drainFlush(s);

    // Both deltas MUST survive. Previous buggy behaviour dropped them.
    const deltas = flushed.filter((e) => e.type === 'message.part.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas.map((e) => (e as { delta: string }).delta)).toEqual([
      'Hel',
      'lo',
    ]);

    // The whole-part is still present ahead of the deltas.
    expect(flushed[0]?.type).toBe('message.part.updated');
  });

  it('still drops deltas when a whole-part REPLACES a prior whole-part (coalesce case)', () => {
    const s = createCoalesceState();

    // First whole-part arrives, then a delta piles up, then a newer
    // whole-part supersedes the first (carries the accumulated text).
    // Deltas between the two whole-parts become redundant and MUST
    // be filtered out — this preserves the existing coalescing
    // semantics.
    enqueueEvent(s, partUpdated('sess1', 'msg1', textPart('p1', '')));
    enqueueEvent(s, partDelta('sess1', 'msg1', 'p1', 'old-chunk'));
    enqueueEvent(s, partUpdated('sess1', 'msg1', textPart('p1', 'final')));

    const flushed = drainFlush(s);

    // Delta dropped; only the superseding whole-part remains.
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.type).toBe('message.part.updated');
    expect((flushed[0] as { part: ConversationMessagePart }).part.text).toBe(
      'final',
    );
  });

  it('deltas for an UNRELATED part are never dropped by coalescing on a different part', () => {
    const s = createCoalesceState();

    enqueueEvent(s, partUpdated('sess1', 'msg1', textPart('pA', '')));
    enqueueEvent(s, partUpdated('sess1', 'msg1', textPart('pA', 'A-done')));
    enqueueEvent(s, partDelta('sess1', 'msg1', 'pB', 'B-first'));

    const flushed = drainFlush(s);
    const deltas = flushed.filter((e) => e.type === 'message.part.delta');
    expect(deltas).toHaveLength(1);
    expect((deltas[0] as { delta: string; partId: string }).delta).toBe(
      'B-first',
    );
    expect((deltas[0] as { delta: string; partId: string }).partId).toBe('pB');
  });
});
