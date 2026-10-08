import { useCallback, useEffect, useRef, useState } from 'react';

type ResizeEdge = 'left' | 'right';

type UseResizablePanelOptions = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  edge?: ResizeEdge;
};

function clampWidth(value: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, value));
}

function readStoredWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: Omit<UseResizablePanelOptions, 'edge'>): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return defaultWidth;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) return defaultWidth;
    return clampWidth(parsed, minWidth, maxWidth);
  } catch {
    return defaultWidth;
  }
}

export interface UseResizablePanelReturn {
  width: number;
  handleRef: React.RefObject<HTMLDivElement | null>;
  isResizing: boolean;
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  edge = 'right',
}: UseResizablePanelOptions): UseResizablePanelReturn {
  const [width, setWidth] = useState<number>(() =>
    readStoredWidth({
      storageKey,
      defaultWidth,
      minWidth,
      maxWidth,
    }),
  );
  const [isResizing, setIsResizing] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const currentWidthRef = useRef(width);

  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      const delta = event.clientX - startXRef.current;
      const signedDelta = edge === 'left' ? -delta : delta;
      setWidth(
        clampWidth(startWidthRef.current + signedDelta, minWidth, maxWidth),
      );
    },
    [edge, maxWidth, minWidth],
  );

  const onMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      localStorage.setItem(storageKey, String(currentWidthRef.current));
    } catch {
      // Ignore storage errors.
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove, storageKey]);

  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      startXRef.current = event.clientX;
      startWidthRef.current = currentWidthRef.current;
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [onMouseMove, onMouseUp],
  );

  useEffect(() => {
    const element = handleRef.current;
    if (!element) return;
    element.addEventListener('mousedown', onMouseDown);
    return () => {
      element.removeEventListener('mousedown', onMouseDown);
    };
  }, [onMouseDown]);

  return { width, handleRef, isResizing };
}
