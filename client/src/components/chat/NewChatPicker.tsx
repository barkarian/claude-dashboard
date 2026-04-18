/**
 * NewChatPicker — bottom sheet / dropdown for selecting which adapter to use
 * when creating a new chat.
 *
 * The list is user-orderable (drag-and-drop). Index 0 is the project default.
 * Reordering persists to the project's `adapterOrder` and also updates
 * `defaultAdapter` to match position 0.
 */

import { useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../ui/drawer.tsx';
import type { AdapterMetadata } from '../../../../shared/types/adapter.ts';

interface EnabledAdapter {
  metadata: AdapterMetadata;
}

interface NewChatPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (adapterId: string) => void;
  enabledAdapters: EnabledAdapter[];
  /** Persisted ordering of adapter IDs. Unknown IDs are filtered, missing IDs are appended. */
  adapterOrder: string[] | null;
  onReorder: (nextOrder: string[]) => void;
}

function AdapterRow({ metadata, isDefault, onSelect }: {
  metadata: AdapterMetadata;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: metadata.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-vaul-no-drag
      className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
        isDefault
          ? 'border-primary/60 bg-primary/5'
          : 'border-border hover:bg-bg-hover/50'
      }`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        data-vaul-no-drag
        aria-label="Reorder"
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-muted cursor-grab active:cursor-grabbing touch-none"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onSelect}
        data-vaul-no-drag
        className="flex-1 min-w-0 flex items-center gap-3 text-left"
      >
        <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded ${metadata.badgeColor}`}>
          {metadata.shortLabel}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text truncate">{metadata.displayName}</span>
            {isDefault && (
              <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                Default
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted truncate">{metadata.description}</div>
        </div>
        <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}

export default function NewChatPicker({ open, onClose, onSelect, enabledAdapters, adapterOrder, onReorder }: NewChatPickerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Effective order: saved order first (intersected with enabled), then any enabled adapters not yet in the order.
  const orderedAdapters = useMemo(() => {
    const byId = new Map(enabledAdapters.map(a => [a.metadata.id, a]));
    const result: EnabledAdapter[] = [];
    const seen = new Set<string>();
    for (const id of adapterOrder || []) {
      const a = byId.get(id);
      if (a && !seen.has(id)) {
        result.push(a);
        seen.add(id);
      }
    }
    for (const a of enabledAdapters) {
      if (!seen.has(a.metadata.id)) {
        result.push(a);
        seen.add(a.metadata.id);
      }
    }
    return result;
  }, [enabledAdapters, adapterOrder]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedAdapters.map(a => a.metadata.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">New Chat</DrawerTitle>
          <p className="text-xs text-text-muted mt-0.5">Drag to reorder. The top agent is the default.</p>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedAdapters.map(a => a.metadata.id)} strategy={verticalListSortingStrategy}>
              {orderedAdapters.map(({ metadata }, index) => (
                <AdapterRow
                  key={metadata.id}
                  metadata={metadata}
                  isDefault={index === 0}
                  onSelect={() => onSelect(metadata.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
