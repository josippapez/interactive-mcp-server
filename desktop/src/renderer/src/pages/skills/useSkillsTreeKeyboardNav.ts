import { useCallback, useRef, useState } from 'react';

export type RowId = string;

export interface UseSkillsTreeKeyboardNavReturn {
  focusedRowId: RowId | null;
  setFocusedRowId: (id: RowId | null) => void;
  onKeyDown: (
    e: React.KeyboardEvent,
    opts: {
      rowId: RowId;
      isFolder: boolean;
      isOpen?: boolean;
      parentFolderId?: RowId | null;
      onToggle?: () => void;
      onSelect?: () => void;
      onRename?: () => void;
      onDelete?: () => void;
    },
  ) => void;
  registerRowRef: (id: RowId, el: HTMLElement | null) => void;
  getVisibleRowIds: () => RowId[];
  setVisibleRowIds: (ids: RowId[]) => void;
}

export function useSkillsTreeKeyboardNav(): UseSkillsTreeKeyboardNavReturn {
  const [focusedRowId, setFocusedRowId] = useState<RowId | null>(null);
  const rowRefsRef = useRef<Map<RowId, HTMLElement>>(new Map());
  const visibleRowIdsRef = useRef<RowId[]>([]);

  const registerRowRef = useCallback((id: RowId, el: HTMLElement | null) => {
    if (el) {
      rowRefsRef.current.set(id, el);
    } else {
      rowRefsRef.current.delete(id);
    }
  }, []);

  const setVisibleRowIds = useCallback((ids: RowId[]) => {
    visibleRowIdsRef.current = ids;
  }, []);

  const getVisibleRowIds = useCallback(() => visibleRowIdsRef.current, []);

  const focusRow = useCallback((id: RowId) => {
    setFocusedRowId(id);
    const el = rowRefsRef.current.get(id);
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      opts: {
        rowId: RowId;
        isFolder: boolean;
        isOpen?: boolean;
        parentFolderId?: RowId | null;
        onToggle?: () => void;
        onSelect?: () => void;
        onRename?: () => void;
        onDelete?: () => void;
      },
    ) => {
      const {
        rowId,
        isFolder,
        isOpen,
        parentFolderId,
        onToggle,
        onSelect,
        onRename,
        onDelete,
      } = opts;
      const ids = visibleRowIdsRef.current;
      const idx = ids.indexOf(rowId);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (idx < ids.length - 1) focusRow(ids[idx + 1]);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (idx > 0) focusRow(ids[idx - 1]);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (isFolder) {
            if (!isOpen) {
              onToggle?.();
            } else {
              const firstChild = ids[idx + 1];
              if (firstChild) focusRow(firstChild);
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (isFolder && isOpen) {
            onToggle?.();
          } else if (!isFolder && parentFolderId) {
            focusRow(parentFolderId);
          } else if (isFolder && !isOpen && parentFolderId) {
            focusRow(parentFolderId);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (isFolder) {
            onToggle?.();
          } else {
            onSelect?.();
          }
          break;
        }
        case 'F2': {
          e.preventDefault();
          if (isFolder) onRename?.();
          break;
        }
        case 'Delete': {
          e.preventDefault();
          if (!isFolder) onDelete?.();
          break;
        }
        default:
          break;
      }
    },
    [focusRow],
  );

  return {
    focusedRowId,
    setFocusedRowId,
    onKeyDown,
    registerRowRef,
    getVisibleRowIds,
    setVisibleRowIds,
  };
}
