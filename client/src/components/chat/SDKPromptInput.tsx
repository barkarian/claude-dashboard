import { useState, useRef, useEffect } from 'react';

import { useLocation } from 'react-router-dom';
import FilePicker from './FilePicker.tsx';
import TerminalRecordButton from './TerminalRecordButton.tsx';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingPreviewPanel from './RecordingPreviewPanel.tsx';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import PreviousMessagePicker from './PreviousMessagePicker.tsx';
import SavedRecordingsPanel, { formatSavedRecording, buildRecordingHeader } from './SavedRecordingsPanel.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import { useIsMobile } from '../../hooks/use-mobile.tsx';
import { haptics } from '../../utils/haptics.ts';
import api from '../../utils/api.ts';
import type { SDKSessionStatus } from '../../../../shared/types/sdk.ts';
import type { SavedRecording } from '../../../../shared/types/models.ts';

interface SDKPromptInputProps {
  projectId: string;
  status: SDKSessionStatus | 'disconnected';
  onSend: (prompt: string) => void;
  onInterrupt: () => void;
  autoFocus?: boolean;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
}

export default function SDKPromptInput({ projectId, status, onSend, onInterrupt, autoFocus, initialDraft, onDraftChange }: SDKPromptInputProps) {
  const location = useLocation();
  const [value, setValue] = useState(initialDraft || '');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewRecordingId, setPreviewRecordingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAutoSendRef = useRef<string | null>(null);

  const { activeRecording, stopRecording, getRecordingContent } = useTerminalRecording();
  const isMobile = useIsMobile();
  const [showSavedRecordings, setShowSavedRecordings] = useState(false);

  // Mobile auto-insert: prepend saved recordings into prompt on chat open
  useEffect(() => {
    if (!isMobile) return;
    api.get<{ recordings: SavedRecording[] }>(`/api/projects/${projectId}/recordings`)
      .then(res => {
        const recs = res.recordings;
        if (!recs?.length) return;
        setValue(prev => {
          // Filter out recordings already present in the prompt (deduplicate by header)
          const newRecs = recs.filter(r => {
            const header = buildRecordingHeader(r);
            return !prev.includes(header);
          });
          if (!newRecs.length) return prev;
          const content = newRecs.map(formatSavedRecording).join('\n\n');
          return content + (prev ? '\n\n' + prev : '');
        });
      })
      .catch(() => {});
  }, [isMobile, projectId]);

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
    const state = location.state as { prefillContent?: string; autoSend?: boolean } | null;
    const prefill = state?.prefillContent;
    if (prefill) {
      if (state?.autoSend) {
        // Store for auto-send once session is ready
        pendingAutoSendRef.current = prefill;
      } else {
        setValue(prefill);
      }
      // Clear the state so it doesn't re-prefill on re-renders
      window.history.replaceState({}, '');
    }
  }, []);

  // Auto-send: when status transitions to idle and we have pending content, send it
  useEffect(() => {
    if (status === 'idle' && pendingAutoSendRef.current) {
      const msg = pendingAutoSendRef.current;
      pendingAutoSendRef.current = null;
      onSend(msg);
    }
  }, [status, onSend]);

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
    haptics.impactMedium();

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
    onDraftChange?.('');
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
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-[60]">
          <FilePicker
            projectId={projectId}
            onSelect={handleFileSelect}
            onClose={() => setShowFilePicker(false)}
          />
        </div>
      )}

      {showScriptPicker && !activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-[60]">
          <ScriptPickerPanel
            projectId={projectId}
            onClose={() => setShowScriptPicker(false)}
            onStarted={() => setShowLivePreview(true)}
          />
        </div>
      )}

      {showSavedRecordings && !activeRecording && !showScriptPicker && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-[60]">
          <div className="bg-bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
            <div className="p-3 border-b border-border">
              <button
                onClick={() => { setShowSavedRecordings(false); setShowScriptPicker(true); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
              >
                <svg className="w-4 h-4 text-danger" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="7" />
                </svg>
                New Recording
              </button>
            </div>
            <SavedRecordingsPanel
              projectId={projectId}
              onInsert={(content) => {
                setValue(prev => content + (prev ? '\n\n' + prev : ''));
                setShowSavedRecordings(false);
              }}
              onClose={() => setShowSavedRecordings(false)}
              compact
            />
          </div>
        </div>
      )}

      {showLivePreview && activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-[60]">
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
        <button
          onClick={() => setShowHistory(true)}
          disabled={disabled}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-text-dim hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-50"
          aria-label="Previous messages"
          title="Previous messages"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <TerminalRecordButton
          onOpenScriptPicker={() => setShowSavedRecordings(true)}
          onOpenLivePreview={() => setShowLivePreview(true)}
          disabled={disabled}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); onDraftChange?.(e.target.value); }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          className="w-full bg-bg border border-border rounded-lg px-3 text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none min-h-[42px] max-h-[200px] py-2.5 flex-1"
          placeholder={
            disabled
              ? 'Session not active'
              : isStreaming
                ? 'Claude is working...'
                : 'How can I help you?'
          }
          rows={1}
          disabled={disabled}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onInterrupt}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-danger text-white active:bg-danger/80 transition-colors"
            title="Stop"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
              !value.trim() || disabled
                ? 'bg-bg-surface border border-border text-text-dim'
                : 'bg-primary text-white active:bg-primary-hover'
            }`}
            title="Send"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Full recording preview modal */}
      {previewRecordingId && (
        <RecordingContentModal
          recordingId={previewRecordingId}
          onClose={() => setPreviewRecordingId(null)}
        />
      )}

      {/* Previous message picker */}
      <PreviousMessagePicker
        open={showHistory}
        onOpenChange={setShowHistory}
        projectId={projectId}
        onSelect={(text) => { setValue(text); onDraftChange?.(text); }}
      />
    </div>
  );
}
