export const VIRTUAL_MESSAGE_THRESHOLD = 80;
export const VIRTUAL_MESSAGE_OVERSCAN = 8;
export const VIRTUAL_MESSAGE_ESTIMATED_HEIGHT_PX = 180;

interface VirtualMessageRowRegistration<TElement extends Element> {
  rowRefs: Map<string, TElement>;
  observedRows: Map<string, TElement>;
  resizeObserver: Pick<ResizeObserver, 'observe' | 'unobserve'> | null;
  measureElement: (node: TElement) => void;
}

export function shouldVirtualizeMessageList(messageCount: number): boolean {
  return messageCount > VIRTUAL_MESSAGE_THRESHOLD;
}

export function getVirtualizedMessageIndex(
  messages: readonly { id: string }[],
  messageId: string,
): number {
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].id === messageId) {
      return index;
    }
  }

  return -1;
}

export function registerVirtualMessageRow<TElement extends Element>(
  id: string,
  node: TElement | null,
  registration: VirtualMessageRowRegistration<TElement>,
): void {
  const previousNode = registration.observedRows.get(id);

  if (!node) {
    registration.rowRefs.delete(id);
    if (previousNode) {
      registration.resizeObserver?.unobserve(previousNode);
      registration.observedRows.delete(id);
    }
    return;
  }

  registration.rowRefs.set(id, node);
  if (previousNode !== node) {
    if (previousNode) {
      registration.resizeObserver?.unobserve(previousNode);
    }
    registration.observedRows.set(id, node);
    registration.resizeObserver?.observe(node);
  }
  registration.measureElement(node);
}
