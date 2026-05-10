import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { FolderDropData } from './SkillsDndContext';

export interface FolderDropZoneProps {
  /**
   * Folder id to drop into. Use `null` for the special "Unfiled" zone
   * (drops here remove an entry from any folder).
   */
  folderId: number | null;
  children: ReactNode;
  className?: string;
}

/**
 * Marks a region as a valid drop target for entry cards.
 *
 * Sets `data-over="true"` while an entry is hovering, so callers can
 * style the highlight via CSS attribute selectors.
 */
export function FolderDropZone({
  folderId,
  children,
  className,
}: FolderDropZoneProps) {
  const data: FolderDropData = { type: 'folder', id: folderId };
  const droppableId =
    folderId === null ? 'folder:unfiled' : `folder:${folderId}`;
  const { isOver, setNodeRef } = useDroppable({ id: droppableId, data });

  return (
    <div
      ref={setNodeRef}
      data-over={isOver ? 'true' : undefined}
      data-folder-id={folderId === null ? 'unfiled' : String(folderId)}
      className={className}
    >
      {children}
    </div>
  );
}
