import { useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet.tsx';
import { usePromptHistory } from '../../hooks/usePromptHistory.ts';

interface PreviousMessagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSelect: (text: string) => void;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day} ${time}`;
}

export default function PreviousMessagePicker({
  open,
  onOpenChange,
  projectId,
  onSelect,
}: PreviousMessagePickerProps) {
  const { entries, loading, hasMore, loadMore, loadInitial } = usePromptHistory(projectId);

  // Load entries when first opened
  useEffect(() => {
    if (open) {
      loadInitial();
    }
  }, [open, loadInitial]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[60vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>Previous Messages</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm">
              No previous messages for this project
            </div>
          ) : (
            <>
              {entries.map((entry, i) => (
                <button
                  key={`${entry.timestamp}-${i}`}
                  onClick={() => {
                    onSelect(entry.display);
                    onOpenChange(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg active:bg-bg-hover transition-colors border-b border-border last:border-0"
                >
                  <div className="text-sm text-text truncate">{entry.display}</div>
                  {entry.timestamp > 0 && (
                    <div className="text-xs text-text-muted mt-0.5">
                      {formatTimestamp(entry.timestamp)}
                    </div>
                  )}
                </button>
              ))}

              {hasMore && (
                <button
                  onClick={loadMore}
                  className="w-full py-2 text-sm text-primary hover:text-primary/80 transition-colors"
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
