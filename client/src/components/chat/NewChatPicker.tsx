/**
 * NewChatPicker — bottom sheet / dropdown for selecting which adapter to use
 * when creating a new chat.
 *
 * The list is user-orderable (drag-and-drop). Index 0 is the project default.
 * Reordering persists to the project's `adapterOrder` and also updates
 * `defaultAdapter` to match position 0.
 */

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../ui/drawer.tsx';
import SortableAdapterList, { type SortableAdapterEntry } from './SortableAdapterList.tsx';

interface NewChatPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (adapterId: string) => void;
  enabledAdapters: SortableAdapterEntry[];
  adapterOrder: string[] | null;
  onReorder: (nextOrder: string[]) => void;
}

export default function NewChatPicker({ open, onClose, onSelect, enabledAdapters, adapterOrder, onReorder }: NewChatPickerProps) {
  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">New Chat</DrawerTitle>
          <p className="text-xs text-text-muted mt-0.5">Drag to reorder. The top agent is the default.</p>
        </DrawerHeader>

        <div className="px-4 pb-4">
          <SortableAdapterList
            adapters={enabledAdapters}
            adapterOrder={adapterOrder}
            onReorder={onReorder}
            onSelect={onSelect}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
