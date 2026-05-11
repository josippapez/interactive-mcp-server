import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'skills-sidebar-width';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
  } catch {
    return DEFAULT_WIDTH;
  }
}

export interface UseResizableSidebarReturn {
  width: number;
  handleRef: React.RefObject<HTMLDivElement | null>;
  isResizing: boolean;
}

/**
 * Drag-resizable sidebar width.
 *
 * - Reads initial width from localStorage on mount.
 * - Writes to localStorage only on drag end (not every pixel).
 * - Clamps between MIN_WIDTH and MAX_WIDTH.
 * - Returns a ref to attach to the drag handle element.
 */
export function useResizableSidebar(): UseResizableSidebarReturn {
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const currentWidthRef = useRef(width);

  // Keep ref in sync so the mouseup handler can read the final value
  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const delta = e.clientX - startXRef.current;
    const next = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, startWidthRef.current + delta),
    );
    setWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      localStorage.setItem(STORAGE_KEY, String(currentWidthRef.current));
    } catch {
      // ignore storage errors
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
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
    const el = handleRef.current;
    if (!el) return;
    el.addEventListener('mousedown', onMouseDown);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
    };
  }, [onMouseDown]);

  return { width, handleRef, isResizing };
}
