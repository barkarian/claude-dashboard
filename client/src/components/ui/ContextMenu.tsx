import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  onAction: () => void;
}

interface ContextMenuProps {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

export default function ContextMenu({ open, onClose, position, items }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const el = menuRef.current;

    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [open, position]);

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose(); }}
      />
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-[9999] min-w-[180px] py-1 bg-bg-surface border border-border rounded-xl shadow-lg shadow-black/40 overflow-hidden"
        style={{ left: position.x, top: position.y }}
      >
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.onAction(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors active:bg-bg-hover ${
              item.variant === 'danger'
                ? 'text-danger'
                : 'text-text'
            }`}
          >
            {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
