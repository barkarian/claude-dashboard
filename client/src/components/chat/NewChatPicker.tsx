/**
 * NewChatPicker — bottom sheet / dropdown for selecting which adapter to use
 * when creating a new chat.
 *
 * Shows enabled adapters with their metadata. If "Set as default" is checked,
 * the selected adapter becomes the project's default for future New Chat actions.
 */

import { useState } from 'react';
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
  onSelect: (adapterId: string, setAsDefault: boolean) => void;
  enabledAdapters: EnabledAdapter[];
}

export default function NewChatPicker({ open, onClose, onSelect, enabledAdapters }: NewChatPickerProps) {
  const [setAsDefault, setSetAsDefault] = useState(false);

  const handleSelect = (adapterId: string) => {
    onSelect(adapterId, setAsDefault);
    setSetAsDefault(false);
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">New Chat</DrawerTitle>
          <p className="text-xs text-text-muted mt-0.5">Choose which agent to use</p>
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-2">
          {enabledAdapters.map(({ metadata }) => (
            <button
              key={metadata.id}
              type="button"
              onClick={() => handleSelect(metadata.id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-bg-hover/50 active:bg-bg-hover transition-colors text-left"
            >
              <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded ${metadata.badgeColor}`}>
                {metadata.shortLabel}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text">{metadata.displayName}</div>
                <div className="text-xs text-text-muted truncate">{metadata.description}</div>
              </div>
              <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ))}
        </div>

        {/* Set as default option */}
        <div className="px-4 pb-4 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setAsDefault}
              onChange={(e) => setSetAsDefault(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
            />
            <span className="text-xs text-text-muted">Set as default for this project</span>
          </label>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
