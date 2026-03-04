import { useContext } from 'react';
import { TerminalRecordingContext, type TerminalRecordingContextValue } from '../context/TerminalRecordingContext.tsx';

export function useTerminalRecording(): TerminalRecordingContextValue {
  const ctx = useContext(TerminalRecordingContext);
  if (!ctx) throw new Error('useTerminalRecording must be used within TerminalRecordingProvider');
  return ctx;
}
