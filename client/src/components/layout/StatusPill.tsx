import { useState } from 'react';
import { toast } from 'sonner';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '../ui/popover.tsx';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../ui/alert-dialog.tsx';
import { useSocket } from '../../context/SocketContext.tsx';
import { useService } from '../../hooks/useService.ts';
import api from '../../utils/api.ts';

/**
 * StatusPill — global connection indicator and shortcut to system actions.
 *
 * Displays the dashboard's WebSocket connection state and exposes
 * Disconnect/Reconnect plus a Shut down action for the host machine.
 * Phase 4 (Catalog) will gate the shutdown row on the Local Computer Service.
 */
export default function StatusPill() {
  const { socket, connected } = useSocket();
  // The shutdown row is gated on the Local Computer service. When disabled,
  // we hide the row entirely (and the server returns 403 anyway).
  const { enabled: localComputerEnabled } = useService('local-computer');
  const [open, setOpen] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  function handleToggleConnection() {
    if (!socket) return;
    if (connected) {
      socket.disconnect();
    } else {
      socket.connect();
    }
    setOpen(false);
  }

  async function handleShutdown() {
    setShuttingDown(true);
    try {
      await api.post('/api/system/shutdown');
      toast.success('Shutting down…');
      setConfirmShutdown(false);
      setOpen(false);
    } catch (err: any) {
      toast.error(`Shutdown failed: ${err?.message || 'unknown error'}`);
    } finally {
      setShuttingDown(false);
    }
  }

  const dotColor = connected ? 'bg-success' : 'bg-danger';
  const label = connected ? 'Connected' : 'Disconnected';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-bg-hover transition-colors"
            aria-label={`Connection status: ${label}`}
            title={label}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? dotColor : `${dotColor} animate-pulse`}`} />
            <span className="hidden md:inline text-xs text-text-muted">{label}</span>
            <svg className="w-3 h-3 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <div className="px-3 py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-sm font-medium text-text">{label}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              {connected
                ? 'Real-time updates are flowing.'
                : 'No live updates. Click Reconnect to retry.'}
            </p>
          </div>
          <div className="p-1">
            <button
              onClick={handleToggleConnection}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-text hover:bg-bg-hover transition-colors"
            >
              <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {connected ? 'Disconnect' : 'Reconnect'}
            </button>
            {localComputerEnabled && (
              <button
                onClick={() => { setOpen(false); setConfirmShutdown(true); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-danger hover:bg-bg-hover transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                </svg>
                Shut down My Computer
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirmShutdown} onOpenChange={setConfirmShutdown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Shut down your computer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will issue a system shutdown command. Any unsaved work will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={shuttingDown}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleShutdown(); }}
              disabled={shuttingDown}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              {shuttingDown ? 'Shutting down…' : 'Shut down'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
