import { describe, it, expect } from 'vitest';
import type { UnifiedMessage } from '../../../types/unified-message';
import { computeAutoScrollSignature } from './auto-scroll-signature';

function msg(overrides: Partial<UnifiedMessage>): UnifiedMessage {
  return {
    id: 'm1',
    source: 'conversation',
    role: 'assistant',
    text: '',
    timestamp: 0,
    ...overrides,
  } as UnifiedMessage;
}

describe('computeAutoScrollSignature', () => {
  it('returns a stable value for empty input', () => {
    expect(computeAutoScrollSignature([])).toBe('0|');
  });

  it('changes when a new message is appended', () => {
    const a = [msg({ id: 'a', text: 'hi' })];
    const b = [...a, msg({ id: 'b', text: '' })];
    expect(computeAutoScrollSignature(a)).not.toBe(
      computeAutoScrollSignature(b),
    );
  });

  it('changes when the streaming assistant text grows', () => {
    const s1 = computeAutoScrollSignature([
      msg({ id: 'x', role: 'assistant', source: 'conversation', text: 'ab' }),
    ]);
    const s2 = computeAutoScrollSignature([
      msg({ id: 'x', role: 'assistant', source: 'conversation', text: 'abc' }),
    ]);
    expect(s1).not.toBe(s2);
  });

  it('changes when reasoning streams in', () => {
    const base = msg({
      id: 'x',
      role: 'assistant',
      source: 'conversation',
      text: 'hi',
    });
    const s1 = computeAutoScrollSignature([{ ...base, reasoning: '' }]);
    const s2 = computeAutoScrollSignature([{ ...base, reasoning: 'thinking' }]);
    expect(s1).not.toBe(s2);
  });

  it('is stable when unrelated fields change', () => {
    const s1 = computeAutoScrollSignature([
      msg({ id: 'x', text: 'hi', timestamp: 1 }),
    ]);
    const s2 = computeAutoScrollSignature([
      msg({ id: 'x', text: 'hi', timestamp: 9999 }),
    ]);
    expect(s1).toBe(s2);
  });

  it('tracks tail user message size when there is no streaming assistant', () => {
    const s1 = computeAutoScrollSignature([
      msg({ id: 'u1', role: 'user', source: 'channel', text: 'hi' }),
    ]);
    const s2 = computeAutoScrollSignature([
      msg({ id: 'u1', role: 'user', source: 'channel', text: 'hi there' }),
    ]);
    expect(s1).not.toBe(s2);
  });
});
