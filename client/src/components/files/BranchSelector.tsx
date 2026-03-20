import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet.tsx';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog.tsx';
import api from '../../utils/api.ts';
import { haptics } from '../../utils/haptics.ts';
import type { BranchList } from '../../../../shared/types/models.ts';

interface BranchSelectorProps {
  projectId: string;
  onBranchChange: () => void;
}

export default function BranchSelector({ projectId, onBranchChange }: BranchSelectorProps) {
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [dirtyAlert, setDirtyAlert] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    try {
      const data = await api.get<BranchList>(`/api/projects/${projectId}/git-branches`);
      setBranches(data);
    } catch {
      // Not a git repo or error — hide selector
      setBranches(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  async function handleCheckout(branch: string) {
    setSwitching(branch);
    try {
      await api.post(`/api/projects/${projectId}/git-checkout`, { branch });
      haptics.impactLight();
      setSheetOpen(false);
      setBranches(prev => prev ? { ...prev, current: branch } : prev);
      onBranchChange();
    } catch (err: any) {
      const msg = err?.message || 'Failed to checkout branch';
      if (msg.includes('uncommitted changes')) {
        setSheetOpen(false);
        setDirtyAlert(branch);
      } else {
        haptics.notificationError();
        alert(msg);
      }
    } finally {
      setSwitching(null);
    }
  }

  function handleSendToChat(message: string) {
    setDirtyAlert(null);
    navigate(`/project/${projectId}/chats`, {
      state: { prefillContent: message },
    });
  }

  if (loading || !branches || (branches.local.length <= 1 && branches.remote.length === 0)) {
    return null;
  }

  return (
    <>
      {/* Compact branch display */}
      <button
        onClick={() => { setSheetOpen(true); loadBranches(); }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover-hover:border-border-light transition-colors min-w-0"
      >
        {/* Git branch icon */}
        <svg className="w-3.5 h-3.5 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3m-12 0h12M18 3v12" />
        </svg>
        <span className="font-mono text-text truncate max-w-[140px]">{branches.current || 'detached'}</span>
        <svg className="w-3 h-3 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Branch picker sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[60vh] flex flex-col">
          <SheetHeader>
            <SheetTitle>Switch Branch</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6 py-2 space-y-1">
            {branches.local.length > 0 && (
              <>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider px-2 py-1">Local</div>
                {branches.local.map((b) => (
                  <button
                    key={b}
                    onClick={() => b !== branches.current && handleCheckout(b)}
                    disabled={b === branches.current || switching !== null}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                      b === branches.current
                        ? 'bg-primary/10 text-primary'
                        : 'active:bg-bg-hover'
                    }`}
                  >
                    <span className="font-mono text-sm truncate flex-1">{b}</span>
                    {b === branches.current && (
                      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    {switching === b && (
                      <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full flex-shrink-0" />
                    )}
                  </button>
                ))}
              </>
            )}
            {branches.remote.length > 0 && (
              <>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider px-2 py-1 mt-2">Remote</div>
                {branches.remote.map((b) => (
                  <button
                    key={`remote-${b}`}
                    onClick={() => handleCheckout(b)}
                    disabled={switching !== null}
                    className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 active:bg-bg-hover transition-colors"
                  >
                    <span className="font-mono text-sm text-text-muted truncate flex-1">{b}</span>
                    {switching === b && (
                      <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full flex-shrink-0" />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Uncommitted changes warning */}
      <AlertDialog open={!!dirtyAlert} onOpenChange={(open) => !open && setDirtyAlert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uncommitted Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have uncommitted changes that would be lost when switching branches. Commit or stash them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleSendToChat(
                `I want to switch to branch "${dirtyAlert}" but I have uncommitted changes. Can you help me commit or stash my current changes first?`
              )}
            >
              Send to Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
