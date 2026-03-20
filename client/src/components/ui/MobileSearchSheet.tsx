import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardVisible } from '../../hooks/useKeyboardVisible.ts';
import { haptics } from '../../utils/haptics.ts';

interface MobileSearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  actionSlot?: ReactNode;
  loading?: boolean;
  emptyContent?: ReactNode;
}

export default function MobileSearchSheet({
  open,
  onOpenChange,
  title,
  children,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  actionSlot,
  loading,
  emptyContent,
}: MobileSearchSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { visible: kbVisible, height: kbHeight } = useKeyboardVisible();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Mount → animate in
  useEffect(() => {
    if (open) {
      setMounted(true);
      haptics.impactLight();
      // Next frame: trigger CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 320);
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Scroll lock
  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mounted]);

  // Escape key
  useEffect(() => {
    if (!mounted) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onOpenChange]);

  if (!mounted) return null;

  const bottomPadding = kbVisible ? kbHeight : 0;

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={() => onOpenChange(false)}
      />

      {/* Sheet container — pinned to bottom */}
      <div
        className="absolute left-0 right-0 bottom-0 flex flex-col transition-transform duration-300 ease-out"
        style={{
          maxHeight: '80vh',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          paddingBottom: bottomPadding,
        }}
      >
        {/* Results area — scrollable, rounded top */}
        <div className="bg-bg-surface rounded-t-2xl flex flex-col min-h-0 flex-1 overflow-hidden">
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
            <div className="w-9 h-1 rounded-full bg-text-dim/30" />
          </div>

          {/* Title row */}
          <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0">
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            {actionSlot}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-4 pb-2 overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : emptyContent ? (
              emptyContent
            ) : (
              children
            )}
          </div>
        </div>

        {/* Search input bar — pinned at bottom of sheet */}
        <div
          className="bg-bg-surface border-t border-border px-3 py-2 flex-shrink-0"
          style={{
            paddingBottom: !kbVisible
              ? 'max(0.5rem, env(safe-area-inset-bottom))'
              : '0.5rem',
          }}
        >
          <div className="relative">
            <svg
              className="w-4 h-4 text-text-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-bg border border-border rounded-xl text-text placeholder:text-text-dim focus:outline-none focus:border-primary transition-colors"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
