import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { useLocation } from 'react-router-dom';
import FilePicker from './FilePicker.tsx';
import TerminalRecordButton from './TerminalRecordButton.tsx';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingPreviewPanel from './RecordingPreviewPanel.tsx';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import type { SDKSessionStatus } from '../../../../shared/types/sdk.ts';

interface SDKPromptInputProps {
  projectId: string;
  status: SDKSessionStatus | 'disconnected';
  onSend: (prompt: string) => void;
  onInterrupt: () => void;
  autoFocus?: boolean;
}

export default function SDKPromptInput({ projectId, status, onSend, onInterrupt, autoFocus }: SDKPromptInputProps) {
  const location = useLocation();
  const [value, setValue] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewRecordingId, setPreviewRecordingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { activeRecording, stopRecording, getRecordingContent } = useTerminalRecording();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);

  // Auto-focus textarea for new chats.
  // Mobile WebViews won't open the keyboard from async callbacks (the user-gesture
  // context has expired by the time the connecting spinner resolves). We use a
  // short setTimeout chain which is the most reliable cross-platform workaround.
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const el = textareaRef.current;
      // Immediate focus (works on desktop)
      el.focus();
      // Delayed retry for mobile WebViews
      const t1 = setTimeout(() => el.focus(), 100);
      const t2 = setTimeout(() => {
        el.focus();
        // Some mobile browsers need a selection range set to trigger the keyboard
        el.setSelectionRange(el.value.length, el.value.length);
      }, 300);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [autoFocus]);

  // Prefill from navigation state (e.g. Send to Chat from scripts)
  useEffect(() => {
    const prefill = (location.state as { prefillContent?: string } | null)?.prefillContent;
    if (prefill) {
      setValue(prefill);
      // Clear the state so it doesn't re-prefill on re-renders
      window.history.replaceState({}, '');
    }
  }, []);

  const isStreaming = status === 'streaming' || status === 'tool-use' || status === 'waiting-permission';
  const disabled = status === 'disconnected' || status === 'exited' || status === 'error';

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === '@') {
      setTimeout(() => {
        setShowFilePicker(true);
        setCursorPosition(textareaRef.current?.selectionStart || 0);
      }, 0);
      return;
    }
    if (e.key === 'Escape') {
      if (showFilePicker) {
        setShowFilePicker(false);
      }
    }
  }

  function handleSend() {
    let text = value.trim();
    if (!text || disabled || isStreaming) return;

    // Expand #rec:ID tokens into formatted terminal output
    const recIds = extractRecordingIds(text);
    for (const id of recIds) {
      const content = getRecordingContent(id);
      if (content) {
        text = text.replace(`#rec:${id}`, content);
      }
    }

    onSend(text);
    setValue('');
  }

  function handleFileSelect(filePath: string) {
    const before = value.slice(0, cursorPosition);
    const after = value.slice(cursorPosition);
    const atIndex = before.lastIndexOf('@');
    const newValue = before.slice(0, atIndex) + '@' + filePath + ' ' + after;
    setValue(newValue);
    setShowFilePicker(false);
    textareaRef.current?.focus();
  }

  function handleStopAndInsert(id: string) {
    setValue(prev => (prev ? prev + ' ' : '') + `#rec:${id}`);
    setShowLivePreview(false);
  }

  function handleRecordingStopped(id: string) {
    setValue(prev => (prev ? prev + ' ' : '') + `#rec:${id}`);
  }

  return (
    <div className="flex-shrink-0 relative border-t border-border p-3">
      {/* Popups above input */}
      {showFilePicker && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3">
          <FilePicker
            projectId={projectId}
            onSelect={handleFileSelect}
            onClose={() => setShowFilePicker(false)}
          />
        </div>
      )}

      {showScriptPicker && !activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3">
          <ScriptPickerPanel
            projectId={projectId}
            onClose={() => setShowScriptPicker(false)}
            onStarted={() => setShowLivePreview(true)}
          />
        </div>
      )}

      {showLivePreview && activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3">
          <RecordingPreviewPanel
            onClose={() => setShowLivePreview(false)}
            onStop={handleStopAndInsert}
          />
        </div>
      )}

      {/* Badge bar for recording tokens */}
      <RecordingBadgeBar
        value={value}
        onValueChange={setValue}
        onBadgeClick={(id) => setPreviewRecordingId(id)}
      />

      <div className="flex items-end gap-2">
        <TerminalRecordButton
          onOpenScriptPicker={() => setShowScriptPicker(true)}
          onOpenLivePreview={() => setShowLivePreview(true)}
          onStop={handleRecordingStopped}
          disabled={disabled}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          className="w-full bg-bg border border-border rounded-lg px-3 text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none min-h-[42px] max-h-[200px] py-2.5 flex-1"
          placeholder={
            disabled
              ? 'Session not active'
              : isStreaming
                ? 'Claude is working...'
                : 'Message Claude Code... (@ for files, Cmd+Enter to send)'
          }
          rows={1}
          disabled={disabled}
        />

        {isStreaming ? (
          <Button onClick={onInterrupt} variant="danger" className="flex-shrink-0 py-2.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="flex-shrink-0 py-2.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </Button>
        )}
      </div>

      {/* Full recording preview modal */}
      {previewRecordingId && (
        <RecordingContentModal
          recordingId={previewRecordingId}
          onClose={() => setPreviewRecordingId(null)}
        />
      )}
    </div>
  );
}
