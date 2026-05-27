import { describe, expect, it, vi } from 'vitest';
import {
  VIRTUAL_MESSAGE_THRESHOLD,
  getVirtualizedMessageIndex,
  registerVirtualMessageRow,
  shouldVirtualizeMessageList,
} from './message-list-virtualization';

describe('shouldVirtualizeMessageList', () => {
  it('keeps the plain list path at and below the threshold', () => {
    expect(shouldVirtualizeMessageList(VIRTUAL_MESSAGE_THRESHOLD - 1)).toBe(
      false,
    );
    expect(shouldVirtualizeMessageList(VIRTUAL_MESSAGE_THRESHOLD)).toBe(false);
  });

  it('uses virtualization after the threshold', () => {
    expect(shouldVirtualizeMessageList(VIRTUAL_MESSAGE_THRESHOLD + 1)).toBe(
      true,
    );
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
