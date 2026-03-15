export interface MouseScrollEventLike {
  scroll?: {
    direction?: 'up' | 'down' | 'left' | 'right';
  };
  stopPropagation?: () => void;
}

export interface TextareaScrollStateLike {
  scrollY?: number;
  virtualLineCount?: number;
  lineCount?: number;
  height?: number;
}

const SCROLL_EPSILON = 1e-3;

const isReliableNumber = (value: number | undefined): value is number =>
  Number.isFinite(value);

const getConservativeTotalLines = (
  textarea: TextareaScrollStateLike,
): number | undefined => {
  const lineCount = textarea.lineCount;
  const virtualLineCount = textarea.virtualLineCount;
  const hasLineCount = isReliableNumber(lineCount);
  const hasVirtualLineCount = isReliableNumber(virtualLineCount);

  if (!hasLineCount && !hasVirtualLineCount) {
    return undefined;
  }

  if (hasLineCount && hasVirtualLineCount) {
    return Math.max(lineCount, virtualLineCount);
  }

  return hasLineCount ? lineCount : virtualLineCount;
};

const canConfidentlyBubbleBoundaryScroll = (
  textarea: TextareaScrollStateLike | null | undefined,
  direction: 'up' | 'down' | 'left' | 'right' | undefined,
) => {
  if (!textarea || !direction) {
    return false;
  }

  if (direction === 'left' || direction === 'right') {
    return false;
  }

  const scrollY = textarea.scrollY;
  if (!isReliableNumber(scrollY)) {
    return false;
  }

  const normalizedScrollY = Math.max(0, scrollY);

  if (direction === 'up') {
    return normalizedScrollY <= SCROLL_EPSILON;
  }

  const viewportHeight = textarea.height;
  const totalLines = getConservativeTotalLines(textarea);
  if (!isReliableNumber(viewportHeight) || !isReliableNumber(totalLines)) {
    return false;
  }

  const maxScrollY = Math.max(0, totalLines - viewportHeight);
  if (maxScrollY <= SCROLL_EPSILON) {
    return false;
  }

  return normalizedScrollY >= maxScrollY - SCROLL_EPSILON;
};

export const routeTextareaMouseScroll = (
  event: MouseScrollEventLike,
  textarea?: TextareaScrollStateLike | null,
) => {
  if (!canConfidentlyBubbleBoundaryScroll(textarea, event.scroll?.direction)) {
    event.stopPropagation?.();
  }
};
