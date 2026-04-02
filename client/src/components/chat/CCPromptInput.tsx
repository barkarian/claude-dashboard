import { useState, useRef, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { haptics } from '../../utils/haptics.ts';
import { isCapacitorNative } from '../../utils/platform.ts';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingPreviewPanel from './RecordingPreviewPanel.tsx';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import PreviousMessagePicker from './PreviousMessagePicker.tsx';
import SavedRecordingsPanel, { formatSavedRecording, buildRecordingHeader } from './SavedRecordingsPanel.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import { useIsMobile } from '../../hooks/use-mobile.tsx';
import api from '../../utils/api.ts';
import type { SavedRecording } from '../../../../shared/types/models.ts';
import type { UnifiedStatus } from '../../../../shared/types/session.ts';
import type { TerminalUIMode } from '../../utils/claudeTerminalRegexDetection.ts';

interface CCPromptInputProps {
  projectId: string;
  status: 'disconnected' | 'running' | 'exited' | 'error';
  terminalUIMode?: TerminalUIMode;
  unifiedStatus?: UnifiedStatus;
  onSend: (data: string) => void;
  onArrow: (data: string) => void;
  onInterrupt: () => void;
  autoFocus?: boolean;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
}

// ANSI escape sequences
const ESC = '\x1b';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';

export default function CCPromptInput({ projectId, status, terminalUIMode, unifiedStatus, onSend, onArrow, onInterrupt, autoFocus, initialDraft, onDraftChange }: CCPromptInputProps) {
  const isSelectionMode = terminalUIMode?.mode === 'multi-choice'
    || terminalUIMode?.mode === 'multi-choice-tabs'
    || terminalUIMode?.mode === 'plan-review';
  const [value, setValue] = useState(initialDraft || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Recording state
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewRecordingId, setPreviewRecordingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
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

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const t1 = setTimeout(() => el.focus(), 100);
      const t2 = setTimeout(() => el.focus(), 300);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [autoFocus]);

  const isRunning = status === 'running';
  const disabled = !isRunning;
  const native = isCapacitorNative();

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !native) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (!value && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const seq = e.key === 'ArrowUp' ? ARROW_UP
        : e.key === 'ArrowDown' ? ARROW_DOWN
        : e.key === 'ArrowLeft' ? ARROW_LEFT
        : ARROW_RIGHT;
      onArrow(seq);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      onArrow(e.shiftKey ? SHIFT_TAB : TAB);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (value.trim()) {
        // First tap: clear the input ("clear line")
        setValue('');
        onDraftChange?.('');
      } else if (
        unifiedStatus === 'working' ||
        unifiedStatus === 'question-awaiting' ||
        unifiedStatus === 'questions-awaiting' ||
        unifiedStatus === 'plan-awaiting' ||
        unifiedStatus === 'permission-awaiting'
      ) {
        // Empty input + active session: send SIGINT to interrupt/cancel
        onInterrupt();
      } else {
        // Idle / starting / exited — forward raw escape to PTY
        onArrow(ESC);
      }
      return;
    }
  }

  function handleSend() {
    if (disabled) return;
    haptics.impactMedium();

    let text = value;
    // Expand #rec:ID tokens into formatted terminal output
    const recIds = extractRecordingIds(text);
    for (const id of recIds) {
      const content = getRecordingContent(id);
      if (content) {
        text = text.replace(`#rec:${id}`, content);
      }
    }

    onSend(text + '\r');
    setValue('');
    onDraftChange?.('');
  }

  function btn(seq: string) {
    if (disabled) return;
    haptics.impactLight();
    onArrow(seq);
  }

  function handleStopAndInsert(id: string) {
    setValue(prev => (prev ? prev + ' ' : '') + `#rec:${id}`);
    setShowLivePreview(false);
  }

  function handleRecordingStopped(id: string) {
    setValue(prev => (prev ? prev + ' ' : '') + `#rec:${id}`);
  }

  // Stop button: shown when Claude is working and prompt is empty
  const showStop = unifiedStatus === 'working' && !value.trim();
  // Send disabled: when prompt is empty and not in selection mode
  const sendDisabled = disabled || (!value.trim() && !isSelectionMode);

  const keyBtnClass = 'h-7 px-2 rounded text-[11px] font-medium text-text-muted bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 flex items-center justify-center gap-1';

  return (
    <div className="flex-shrink-0 border-t border-border relative">
      {/* Recording popups above input */}
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

      {/* Navigation bar — all buttons same height (h-7) */}
      <div className="flex items-center px-2 py-1.5 bg-bg-surface/50 gap-1">
        {/* Esc */}
        <button type="button" onClick={() => btn(ESC)} disabled={disabled} className={keyBtnClass}>
          Esc
        </button>

        {/* Switch Mode (Shift+Tab) */}
        <button type="button" onClick={() => btn(SHIFT_TAB)} disabled={disabled} className={keyBtnClass}>
          Switch Mode
        </button>

        {/* Keys popover — Tab, Ctrl+C, /resume, /btw, Rec */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled} className={keyBtnClass}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              More
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="p-1.5 min-w-[170px]">
            <button
              onClick={() => btn(TAB)}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Tab
            </button>
            <button
              onClick={() => { haptics.impactMedium(); onInterrupt(); }}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors text-danger disabled:opacity-30"
            >
              Ctrl+C
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => {
                haptics.impactMedium();
                onSend('/resume\r');
              }}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30 flex items-center gap-2"
            >
              <span className="font-mono text-primary text-xs">/resume</span>
              <span className="text-text-dim text-xs">Resume</span>
            </button>
            <button
              onClick={() => {
                haptics.impactLight();
                setValue('/btw ');
                onDraftChange?.('/btw ');
                setTimeout(() => textareaRef.current?.focus(), 50);
              }}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30 flex items-center gap-2"
            >
              <span className="font-mono text-primary text-xs">/btw</span>
              <span className="text-text-dim text-xs">Context</span>
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => {
                haptics.impactLight();
                setShowSavedRecordings(true);
              }}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-danger" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="5" />
              </svg>
              <span className="text-xs">Record</span>
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Prompt input area */}
      <div className="px-3 pb-3 pt-1.5">
        {/* Badge bar for recording tokens */}
        <RecordingBadgeBar
          value={value}
          onValueChange={setValue}
          onBadgeClick={(id) => setPreviewRecordingId(id)}
        />

        <div className="flex items-end gap-1.5">
          {/* Previous message picker — compact icon button */}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            disabled={disabled}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-bg-surface border border-border text-text-dim hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-30"
            title="Previous messages"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onDraftChange?.(e.target.value);
            }}
            onFocus={() => {
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
              }
            }}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            className="w-full bg-bg border border-border rounded-lg px-3 text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none min-h-[36px] max-h-[200px] py-2 flex-1 text-sm"
            placeholder={
              disabled
                ? 'Session not active'
                : 'How can I help you?'
            }
            rows={1}
            disabled={disabled}
          />

          {/* Icon-only Send / Select / Stop button */}
          {showStop ? (
            <button
              type="button"
              onClick={() => { haptics.impactMedium(); onInterrupt(); }}
              disabled={disabled}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-danger text-white active:bg-danger/80 transition-colors disabled:opacity-30"
              title="Stop"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (() => {
            const showSelect = !!(isSelectionMode && !value.trim());
            return (
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                  sendDisabled
                    ? 'bg-bg-surface border border-border text-text-dim'
                    : 'bg-primary text-white active:bg-primary-hover'
                }`}
                title={showSelect ? 'Select' : 'Send'}
              >
                {showSelect ? (
                  /* Checkmark circle for select */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  /* Up arrow for send */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                )}
              </button>
            );
          })()}
        </div>
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
        onSelect={(text) => {
          setValue(text);
          onDraftChange?.(text);
        }}
      />
    </div>
  );
}
