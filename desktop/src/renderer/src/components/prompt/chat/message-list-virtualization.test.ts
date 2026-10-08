import { describe, expect, it, vi } from 'vitest';
import {
  buildTimelineRows,
  getVirtualizedMessageIndex,
  registerVirtualMessageRow,
  shouldVirtualizeMessageList,
} from './message-list-virtualization';

describe('shouldVirtualizeMessageList', () => {
  it('uses virtualization consistently like the OpenCode timeline', () => {
    expect(shouldVirtualizeMessageList(0)).toBe(true);
    expect(shouldVirtualizeMessageList(1)).toBe(true);
  });
});

describe('buildTimelineRows', () => {
  it('splits assistant reasoning, text, and tools into timeline rows', () => {
    const rows = buildTimelineRows([
      {
        id: 'assistant_1',
        source: 'conversation',
        role: 'assistant',
        text: 'Done',
        reasoning: 'Planning',
        timestamp: 1,
        toolCalls: [
          { id: 'tool_1', name: 'read', status: 'completed' },
          { id: 'tool_2', name: 'grep', status: 'completed' },
          { id: 'tool_3', name: 'bash', status: 'completed' },
        ],
      },
    ]);

    expect(rows.map((row) => row.type)).toEqual([
      'assistant-reasoning',
      'assistant-text',
      'assistant-tools',
      'assistant-tools',
    ]);
    expect(rows.map((row) => row.key)).toEqual([
      'assistant-reasoning:assistant_1',
      'assistant-text:assistant_1',
      'assistant-tools:assistant_1:context:tool_1',
      'assistant-tools:assistant_1:tool:tool_3',
    ]);
  });

  it('adds an active thinking row when the assistant is busy without visible content', () => {
    const rows = buildTimelineRows([
      {
        id: 'assistant_1',
        source: 'conversation',
        role: 'assistant',
        text: '',
        timestamp: 1,
        isActivePrompt: true,
      },
    ]);

    expect(rows.map((row) => row.type)).toEqual(['assistant-thinking']);
    expect(rows[0]?.messageId).toBe('assistant_1');
  });

  it('keeps user messages as a single user row', () => {
    const rows = buildTimelineRows([
      {
        id: 'user_1',
        source: 'conversation',
        role: 'user',
        text: 'Hello',
        timestamp: 1,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('message');
    expect(rows[0]?.messageId).toBe('user_1');
  });
});

describe('getVirtualizedMessageIndex', () => {
  it('returns the index for a matching message id', () => {
    expect(
      getVirtualizedMessageIndex(
        [{ id: 'msg_1' }, { id: 'msg_2' }, { id: 'msg_3' }],
        'msg_2',
      ),
    ).toBe(1);
  });

  it('returns -1 when no message matches', () => {
    expect(getVirtualizedMessageIndex([{ id: 'msg_1' }], 'missing')).toBe(-1);
  });
});

describe('registerVirtualMessageRow', () => {
  it('observes and measures mounted virtual rows', () => {
    const node = { id: 'node' } as unknown as HTMLDivElement;
    const rowRefs = new Map<string, HTMLDivElement>();
    const observedRows = new Map<string, HTMLDivElement>();
    const resizeObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const measureElement = vi.fn();

    registerVirtualMessageRow('msg_1', node, {
      rowRefs,
      observedRows,
      resizeObserver,
      measureElement,
    });

    expect(rowRefs.get('msg_1')).toBe(node);
    expect(observedRows.get('msg_1')).toBe(node);
    expect(resizeObserver.observe).toHaveBeenCalledWith(node);
    expect(measureElement).toHaveBeenCalledWith(node);
  });

  it('unobserves stale nodes when a virtual row remounts', () => {
    const oldNode = { id: 'old' } as unknown as HTMLDivElement;
    const nextNode = { id: 'next' } as unknown as HTMLDivElement;
    const rowRefs = new Map([['msg_1', oldNode]]);
    const observedRows = new Map([['msg_1', oldNode]]);
    const resizeObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };

    registerVirtualMessageRow('msg_1', nextNode, {
      rowRefs,
      observedRows,
      resizeObserver,
      measureElement: vi.fn(),
    });

    expect(rowRefs.get('msg_1')).toBe(nextNode);
    expect(observedRows.get('msg_1')).toBe(nextNode);
    expect(resizeObserver.unobserve).toHaveBeenCalledWith(oldNode);
    expect(resizeObserver.observe).toHaveBeenCalledWith(nextNode);
  });

  it('unobserves and clears rows on unmount', () => {
    const node = { id: 'node' } as unknown as HTMLDivElement;
    const rowRefs = new Map([['msg_1', node]]);
    const observedRows = new Map([['msg_1', node]]);
    const resizeObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };

    registerVirtualMessageRow('msg_1', null, {
      rowRefs,
      observedRows,
      resizeObserver,
      measureElement: vi.fn(),
    });

    expect(rowRefs.has('msg_1')).toBe(false);
    expect(observedRows.has('msg_1')).toBe(false);
    expect(resizeObserver.unobserve).toHaveBeenCalledWith(node);
  });
});
