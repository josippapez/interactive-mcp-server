import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  accumulateDelta,
  applyDeltas,
  applyPendingParts,
  createDeltaBatcher,
  deltaKey,
  inferPartType,
  type DeltaBuffer,
  type PendingPartsBuffer,
  type TextDelta,
} from './delta-batcher';
import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/index';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDelta(overrides: Partial<TextDelta> = {}): TextDelta {
  return {
    sessionId: 'sess-1',
    messageId: 'msg-1',
    partId: 'part-1',
    text: 'a',
    ...overrides,
  };
}

function makeMessage(
  id: string,
  parts: { id: string; text: string }[] = [],
): ConversationMessage {
  return {
    id,
    sessionId: 'sess-1',
    role: 'assistant',
    createdAt: Date.now(),
    parts: parts.map((p) => ({
      id: p.id,
      type: 'text' as const,
      text: p.text,
    })),
  };
}

// ── deltaKey ─────────────────────────────────────────────────────────────────

describe('deltaKey', () => {
  it('produces a string from messageId and partId', () => {
    expect(deltaKey('m1', 'p1')).toBe('m1:p1');
  });
});

// ── accumulateDelta ──────────────────────────────────────────────────────────

describe('accumulateDelta', () => {
  it('adds a new entry when the key does not exist', () => {
    const buf: DeltaBuffer = new Map();
    const delta = makeDelta({ text: 'hello' });
    accumulateDelta(buf, delta);

    expect(buf.size).toBe(1);
    const entry = buf.get(deltaKey('msg-1', 'part-1'));
    expect(entry).toBeDefined();
    expect(entry!.text).toBe('hello');
  });

  it('appends text when the key already exists', () => {
    const buf: DeltaBuffer = new Map();
    accumulateDelta(buf, makeDelta({ text: 'hel' }));
    accumulateDelta(buf, makeDelta({ text: 'lo' }));

    const entry = buf.get(deltaKey('msg-1', 'part-1'));
    expect(entry!.text).toBe('hello');
  });

  it('keeps entries separate for different keys', () => {
    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'a', partId: 'p1', text: 'x' }),
    );
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'b', partId: 'p2', text: 'y' }),
    );

    expect(buf.size).toBe(2);
    expect(buf.get(deltaKey('a', 'p1'))!.text).toBe('x');
    expect(buf.get(deltaKey('b', 'p2'))!.text).toBe('y');
  });
});

// ── applyDeltas ──────────────────────────────────────────────────────────────

describe('applyDeltas', () => {
  it('returns same reference when buffer is empty', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'hi' }])];
    const buf: DeltaBuffer = new Map();
    const result = applyDeltas(msgs, buf);
    expect(result).toBe(msgs); // referential equality
  });

  it('appends text to an existing part', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'hel' }])];
    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm1', partId: 'p1', text: 'lo' }),
    );

    const result = applyDeltas(msgs, buf);
    expect(result).not.toBe(msgs); // new array
    expect(result[0].parts[0].text).toBe('hello');
  });

  it('creates a new part when partId is unknown', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'existing' }])];
    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm1', partId: 'p2', text: 'new-part' }),
    );

    const result = applyDeltas(msgs, buf);
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[1].text).toBe('new-part');
    expect(result[0].parts[1].id).toBe('p2');
  });

  it('ignores deltas when messageId is unknown (no placeholder)', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'hi' }])];
    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm2', partId: 'p1', text: 'new-msg' }),
    );

    const result = applyDeltas(msgs, buf);
    expect(result).toBe(msgs);
    expect(result).toHaveLength(1);
  });

  it('handles multiple deltas for the same part in one flush', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'a' }])];
    const buf: DeltaBuffer = new Map();
    // accumulateDelta already concatenates, so one entry with combined text
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm1', partId: 'p1', text: 'bc' }),
    );
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm1', partId: 'p1', text: 'de' }),
    );

    const result = applyDeltas(msgs, buf);
    expect(result[0].parts[0].text).toBe('abcde');
  });

  it('preserves unrelated messages via structural sharing', () => {
    const m1 = makeMessage('m1', [{ id: 'p1', text: 'unchanged' }]);
    const m2 = makeMessage('m2', [{ id: 'p2', text: 'target' }]);
    const msgs = [m1, m2];

    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'm2', partId: 'p2', text: '!' }),
    );

    const result = applyDeltas(msgs, buf);
    // m1 should be the exact same object (structural sharing)
    expect(result[0]).toBe(m1);
    // m2 should be a new object
    expect(result[1]).not.toBe(m2);
    expect(result[1].parts[0].text).toBe('target!');
  });

  it('preserves mode field when applying deltas to existing message', () => {
    // Simulate a fetched message with mode: 'compaction'
    const compactionMsg: ConversationMessage = {
      id: 'compaction-msg',
      sessionId: 'sess-1',
      role: 'assistant',
      mode: 'compaction',
      createdAt: Date.now(),
      parts: [
        { id: 'p1', type: 'compaction', text: 'Summary of previous context' },
      ],
    };
    const msgs = [compactionMsg];

    const buf: DeltaBuffer = new Map();
    // Simulate delta that arrived after fetch - appending to existing part
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'compaction-msg', partId: 'p1', text: '...' }),
    );

    const result = applyDeltas(msgs, buf);

    // mode should be preserved
    expect(result[0].mode).toBe('compaction');
    // Text should be appended
    expect(result[0].parts[0].text).toBe('Summary of previous context...');
    // Part type should be preserved (not overwritten to 'text')
    expect(result[0].parts[0].type).toBe('compaction');
  });

  it('does not create placeholder messages from unknown deltas', () => {
    const msgs: ConversationMessage[] = [];

    const buf: DeltaBuffer = new Map();
    accumulateDelta(
      buf,
      makeDelta({ messageId: 'new-msg', partId: 'p1', text: 'Hello' }),
    );

    const result = applyDeltas(msgs, buf);
    expect(result).toBe(msgs);
    expect(result).toHaveLength(0);
  });
});

// ── createDeltaBatcher ───────────────────────────────────────────────────────

describe('createDeltaBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call setMessages synchronously on push', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    batcher.push(makeDelta({ text: 'hello' }));
    expect(setter).toHaveBeenCalledTimes(1);

    batcher.dispose();
  });

  it('flushes accumulated deltas after PACE_MS', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    batcher.push(makeDelta({ text: 'a' }));
    batcher.push(makeDelta({ text: 'b' }));
    batcher.push(makeDelta({ text: 'c' }));

    expect(setter).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);

    expect(setter).toHaveBeenCalledTimes(2);

    const firstUpdater = setter.mock.calls[0][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const secondUpdater = setter.mock.calls[1][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const prev = [makeMessage('msg-1', [{ id: 'part-1', text: '' }])];
    const result = secondUpdater(firstUpdater(prev));
    expect(result[0].parts[0].text).toBe('abc');

    batcher.dispose();
  });

  it('coalesces multiple pushes into one flush', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    // Push many deltas rapidly
    for (let i = 0; i < 100; i++) {
      batcher.push(makeDelta({ text: 'x' }));
    }

    vi.advanceTimersByTime(25);

    expect(setter).toHaveBeenCalledTimes(2);

    batcher.dispose();
  });

  it('flush() forces an immediate flush', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    batcher.push(makeDelta({ text: 'urgent' }));
    batcher.flush();

    expect(setter).toHaveBeenCalledTimes(1);

    batcher.dispose();
  });

  it('dispose() flushes remaining deltas', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    batcher.push(makeDelta({ text: 'leftover' }));
    batcher.dispose();

    expect(setter).toHaveBeenCalledTimes(1);
  });

  it('does not flush when buffer is empty', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    vi.advanceTimersByTime(50);
    expect(setter).not.toHaveBeenCalled();

    batcher.dispose();
    expect(setter).not.toHaveBeenCalled();
  });

  it('addPart schedules a flush with the part', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    const reasoningPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Let me think about this...',
    };

    batcher.addPart('sess-1', 'msg-1', reasoningPart);

    expect(setter).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);

    expect(setter).toHaveBeenCalledTimes(1);

    // Verify the part was added
    const updater = setter.mock.calls[0][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const prev = [makeMessage('msg-1', [{ id: 'p1', text: 'Hello' }])];
    const result = updater(prev);

    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[1].id).toBe('reasoning-1');
    expect(result[0].parts[1].type).toBe('reasoning');
    expect(result[0].parts[1].text).toBe('Let me think about this...');

    batcher.dispose();
  });

  it('addPart ignores unknown messages (no placeholder)', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    const reasoningPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Thinking...',
    };

    batcher.addPart('sess-1', 'new-msg', reasoningPart);
    vi.advanceTimersByTime(25);

    const updater = setter.mock.calls[0][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const result = updater([]);

    expect(result).toHaveLength(0);

    batcher.dispose();
  });

  it('combines deltas and parts in the same flush', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    // Push text delta first
    batcher.push(
      makeDelta({ messageId: 'msg-1', partId: 'text-1', text: 'Hello ' }),
    );

    // Then add a reasoning part
    const reasoningPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Thinking...',
    };
    batcher.addPart('sess-1', 'msg-1', reasoningPart);

    vi.advanceTimersByTime(25);

    expect(setter).toHaveBeenCalledTimes(2);

    const firstUpdater = setter.mock.calls[0][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const secondUpdater = setter.mock.calls[1][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const prev = [makeMessage('msg-1', [{ id: 'text-1', text: '' }])];
    const result = secondUpdater(firstUpdater(prev));

    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0].text).toBe('Hello ');
    expect(result[0].parts[1].type).toBe('reasoning');

    batcher.dispose();
  });

  it('suppresses stale deltas when a full part update for same part arrives', () => {
    const setter = vi.fn();
    const batcher = createDeltaBatcher(setter);

    batcher.push(
      makeDelta({ messageId: 'msg-1', partId: 'text-1', text: 'Hello ' }),
    );
    batcher.addPart('sess-1', 'msg-1', {
      id: 'text-1',
      type: 'text',
      text: 'Hello world',
    });

    // This delta should be ignored because the part snapshot superseded it.
    batcher.push(
      makeDelta({ messageId: 'msg-1', partId: 'text-1', text: '!!!' }),
    );

    vi.advanceTimersByTime(25);

    expect(setter).toHaveBeenCalledTimes(2);

    const firstUpdater = setter.mock.calls[0][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const secondUpdater = setter.mock.calls[1][0] as (
      prev: ConversationMessage[],
    ) => ConversationMessage[];
    const prev = [makeMessage('msg-1', [{ id: 'text-1', text: '' }])];
    const result = secondUpdater(firstUpdater(prev));

    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0].text).toBe('Hello world');

    batcher.dispose();
  });
});

// ── applyPendingParts ────────────────────────────────────────────────────────

describe('applyPendingParts', () => {
  function makePendingPart(
    messageId: string,
    part: ConversationMessagePart,
    sessionId = 'sess-1',
  ): {
    key: string;
    value: {
      sessionId: string;
      messageId: string;
      part: ConversationMessagePart;
    };
  } {
    return {
      key: deltaKey(messageId, part.id),
      value: { sessionId, messageId, part },
    };
  }

  it('returns same reference when buffer is empty', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'hi' }])];
    const buf: PendingPartsBuffer = new Map();
    const result = applyPendingParts(msgs, buf);
    expect(result).toBe(msgs);
  });

  it('adds a new part to an existing message', () => {
    const msgs = [makeMessage('m1', [{ id: 'p1', text: 'Hello' }])];
    const buf: PendingPartsBuffer = new Map();

    const pendingPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Thinking...',
    };
    const { key, value } = makePendingPart('m1', pendingPart);
    buf.set(key, value);

    const result = applyPendingParts(msgs, buf);

    expect(result).not.toBe(msgs);
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[1].id).toBe('reasoning-1');
    expect(result[0].parts[1].type).toBe('reasoning');
  });

  it('updates an existing part with longer text', () => {
    const msgs: ConversationMessage[] = [
      {
        id: 'm1',
        sessionId: 'sess-1',
        role: 'assistant',
        createdAt: Date.now(),
        parts: [
          {
            id: 'reasoning-1',
            type: 'reasoning',
            text: 'Short',
          },
        ],
      },
    ];
    const buf: PendingPartsBuffer = new Map();

    const pendingPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Much longer thinking content...',
    };
    const { key, value } = makePendingPart('m1', pendingPart);
    buf.set(key, value);

    const result = applyPendingParts(msgs, buf);

    expect(result[0].parts[0].text).toBe('Much longer thinking content...');
  });

  it('preserves existing part when incoming has shorter text', () => {
    const msgs: ConversationMessage[] = [
      {
        id: 'm1',
        sessionId: 'sess-1',
        role: 'assistant',
        createdAt: Date.now(),
        parts: [
          {
            id: 'reasoning-1',
            type: 'reasoning',
            text: 'This is a longer existing text from streaming',
          },
        ],
      },
    ];
    const buf: PendingPartsBuffer = new Map();

    const pendingPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Short',
    };
    const { key, value } = makePendingPart('m1', pendingPart);
    buf.set(key, value);

    const result = applyPendingParts(msgs, buf);

    // Should keep the longer existing text
    expect(result[0].parts[0].text).toBe(
      'This is a longer existing text from streaming',
    );
  });

  it('ignores pending parts when message does not exist', () => {
    const msgs: ConversationMessage[] = [];
    const buf: PendingPartsBuffer = new Map();

    const pendingPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'Thinking...',
    };
    const { key, value } = makePendingPart('new-msg', pendingPart);
    buf.set(key, value);

    const result = applyPendingParts(msgs, buf);

    expect(result).toBe(msgs);
    expect(result).toHaveLength(0);
  });

  it('preserves unrelated messages via structural sharing', () => {
    const m1 = makeMessage('m1', [{ id: 'p1', text: 'unchanged' }]);
    const m2 = makeMessage('m2', [{ id: 'p2', text: 'target' }]);
    const msgs = [m1, m2];

    const buf: PendingPartsBuffer = new Map();
    const pendingPart: ConversationMessagePart = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: 'New part',
    };
    const { key, value } = makePendingPart('m2', pendingPart);
    buf.set(key, value);

    const result = applyPendingParts(msgs, buf);

    // m1 should be the exact same object
    expect(result[0]).toBe(m1);
    // m2 should be a new object
    expect(result[1]).not.toBe(m2);
    expect(result[1].parts).toHaveLength(2);
  });
});

// ── inferPartType ────────────────────────────────────────────────────────────

describe('inferPartType', () => {
  it('returns text by default', () => {
    expect(inferPartType('p1', 'Hello world')).toBe('text');
  });

  it('detects compaction via <compaction> opening tag', () => {
    expect(inferPartType('p1', '<compaction>Summary...')).toBe('compaction');
  });

  it('detects compaction via </compaction> closing tag', () => {
    expect(inferPartType('p1', 'content</compaction>')).toBe('compaction');
  });

  it('detects reasoning from the streamed part id', () => {
    expect(inferPartType('reasoning-1', 'Thinking...')).toBe('reasoning');
  });

  it('treats thinking part ids as reasoning aliases', () => {
    expect(inferPartType('thinking-1', 'Thinking...')).toBe('reasoning');
  });

  it('prefers pending part type over text detection', () => {
    const pendingParts: PendingPartsBuffer = new Map();
    const part: ConversationMessagePart = {
      id: 'p1',
      type: 'reasoning',
      text: 'Thinking...',
    };
    pendingParts.set(deltaKey('m1', 'p1'), {
      sessionId: 'sess-1',
      messageId: 'm1',
      part,
    });

    // Even though text doesn't contain <compaction>, it returns 'reasoning' from pending
    expect(inferPartType('p1', 'Regular text', pendingParts, 'm1')).toBe(
      'reasoning',
    );
  });

  it('returns text when pending part has text type', () => {
    const pendingParts: PendingPartsBuffer = new Map();
    const part: ConversationMessagePart = {
      id: 'p1',
      type: 'text',
      text: 'Some text',
    };
    pendingParts.set(deltaKey('m1', 'p1'), {
      sessionId: 'sess-1',
      messageId: 'm1',
      part,
    });

    // When pending part is 'text', should still detect compaction from content
    expect(inferPartType('p1', '<compaction>Summary', pendingParts, 'm1')).toBe(
      'compaction',
    );
  });

  it('returns text when no matching pending part', () => {
    const pendingParts: PendingPartsBuffer = new Map();
    // No matching part for this messageId/partId
    expect(inferPartType('p1', 'Regular text', pendingParts, 'm1')).toBe(
      'text',
    );
  });
});
