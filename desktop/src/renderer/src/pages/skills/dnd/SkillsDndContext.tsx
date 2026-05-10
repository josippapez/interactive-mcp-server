import { useCallback, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

/**
 * Data attached to a draggable entry (skill / instruction card).
 */
export interface EntryDragData {
  type: 'entry';
  name: string;
}

/**
 * Data attached to a draggable folder (used for folder reordering).
 */
export interface FolderDragData {
  type: 'folder-handle';
  id: number;
}

/**
 * Data attached to a droppable folder zone.
 * `id` is the folder id, or `null` for the "Unfiled" zone.
 */
export interface FolderDropData {
  type: 'folder';
  id: number | null;
}

type AnyDragData = EntryDragData | FolderDragData | FolderDropData;

function isEntryData(data: unknown): data is EntryDragData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'entry'
  );
}

function isFolderHandleData(data: unknown): data is FolderDragData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'folder-handle'
  );
}

function isFolderDropData(data: unknown): data is FolderDropData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'folder'
  );
}

export interface SkillsDndProviderProps {
  children: ReactNode;
  /**
   * Called when an entry card is dropped onto a folder drop zone.
   * `folderId` is `null` when the entry is dropped on the "Unfiled" zone.
   */
  onDropEntryToFolder: (name: string, folderId: number | null) => void;
  /**
   * Optional: called when folders are reordered.
   * Receives the new ordered array of folder ids.
   */
  onReorderFolders?: (orderedIds: number[]) => void;
  /**
   * Current folder id order. Required when `onReorderFolders` is provided
   * so the SortableContext can compute new ordering.
   */
  folderIds?: number[];
}

/**
 * Wraps children in a configured DndContext.
 *
 * Sensors:
 *  - PointerSensor with 8px activation distance (so plain clicks don't
 *    trigger drags).
 *  - KeyboardSensor with sortable keyboard coordinates for a11y.
 *
 * Renders a generic DragOverlay "ghost" for the active entry.
 */
export function SkillsDndProvider({
  children,
  onDropEntryToFolder,
  onReorderFolders,
  folderIds,
}: SkillsDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeData, setActiveData] = useState<AnyDragData | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (isEntryData(data) || isFolderHandleData(data)) {
      setActiveData(data);
    } else {
      setActiveData(null);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveData(null);
      const { active, over } = event;
      if (!over) return;

      const activeDataCurrent = active.data.current;
      const overDataCurrent = over.data.current;

      // Entry dropped on a folder zone.
      if (isEntryData(activeDataCurrent) && isFolderDropData(overDataCurrent)) {
        onDropEntryToFolder(activeDataCurrent.name, overDataCurrent.id);
        return;
      }

      // Folder reorder.
      if (
        isFolderHandleData(activeDataCurrent) &&
        isFolderHandleData(overDataCurrent) &&
        onReorderFolders &&
        folderIds &&
        active.id !== over.id
      ) {
        const oldIndex = folderIds.indexOf(activeDataCurrent.id);
        const newIndex = folderIds.indexOf(overDataCurrent.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorderFolders(arrayMove(folderIds, oldIndex, newIndex));
        }
      }
    },
    [onDropEntryToFolder, onReorderFolders, folderIds],
  );

  const handleDragCancel = useCallback(() => {
    setActiveData(null);
  }, []);

  const sortableIds = folderIds ?? [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeData && isEntryData(activeData) ? (
          <div
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-lg"
            data-skills-dnd-ghost="entry"
          >
            {activeData.name}
          </div>
        ) : null}
        {activeData && isFolderHandleData(activeData) ? (
          <div
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-lg"
            data-skills-dnd-ghost="folder"
          >
            Folder #{activeData.id}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
