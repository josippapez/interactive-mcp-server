import { useResizablePanel } from '../../hooks/useResizablePanel';

const STORAGE_KEY = 'skills-sidebar-width';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

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
  return useResizablePanel({
    storageKey: STORAGE_KEY,
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    edge: 'right',
  });
}
