import type { CSSProperties, ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { EntryDragData } from './SkillsDndContext';

export interface DraggableEntryCardProps {
  /** Unique entry name (skill or instruction). Used as draggable id. */
  entryName: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps an entry card so it can be picked up and dropped on a FolderDropZone.
 *
 * The wrapper sets `data-dragging="true"` on the rendered element while a drag
 * is active, so styling is handled via CSS attribute selectors.
 */
export function DraggableEntryCard({
  entryName,
  children,
  className,
}: DraggableEntryCardProps) {
  const data: EntryDragData = { type: 'entry', name: entryName };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `entry:${entryName}`,
      data,
    });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? 'true' : undefined}
      className={className}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
