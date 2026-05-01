import { useState, useRef, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { haptics } from '../../utils/haptics.ts';
import { isCapacitorNative } from '../../utils/platform.ts';
import { recordingPanelTrigger } from '../../utils/recordingPanelTrigger.ts';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import PreviousMessagePicker from './PreviousMessagePicker.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
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
  onClearDraft?: () => void;
}

// ANSI escape sequences
const ESC = '\x1b';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';

export default function CCPromptInput({ projectId, status, terminalUIMode, unifiedStatus, onSend, onArrow, onInterrupt, autoFocus, initialDraft, onDraftChange, onClearDraft }: CCPromptInputProps) {
  const isSelectionMode = terminalUIMode?.mode === 'multi-choice'
    || terminalUIMode?.mode === 'multi-choice-tabs'
    || terminalUIMode?.mode === 'plan-review'
    || terminalUIMode?.mode === 'session-search';
  const isSessionSearch = terminalUIMode?.mode === 'session-search';
  const [value, setValue] = useState(initialDraft || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Recording state
  const [previewRecordingId, setPreviewRecordingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { getRecordingContent } = useTerminalRecording();
  const [moreOpen, setMoreOpen] = useState(false);
  const [focused, setFocused] = useState(false);

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

  // Track whether the terminal search box has content (from us)
  const searchHasContentRef = useRef(false);
  useEffect(() => {
    if (!isSessionSearch) searchHasContentRef.current = false;
  }, [isSessionSearch]);

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
        onClearDraft?.();
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

    // Session search mode: type text into terminal search box (no Enter)
    if (isSessionSearch && value.trim()) {
      // If search box already has content, send Escape to clear it first
      if (searchHasContentRef.current) {
        onArrow(ESC);
        // Small delay so the Escape clears the box before we type
        setTimeout(() => onArrow(value), 100);
      } else {
        onArrow(value);
      }
      searchHasContentRef.current = true;
      setValue('');
      onClearDraft?.();
      return;
    }

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
    onClearDraft?.();
  }

  function btn(seq: string) {
    if (disabled) return;
    haptics.impactLight();
    onArrow(seq);
  }

  // Stop button: shown when Claude is working and prompt is empty
  const showStop = unifiedStatus === 'working' && !value.trim();
  // Send disabled: when prompt is empty and not in selection mode
  const sendDisabled = disabled || (!value.trim() && !isSelectionMode);

  const keyBtnClass = 'h-9 px-3 rounded text-xs font-medium text-text-muted bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 flex items-center justify-center gap-1';

  return (
    <div className="flex-shrink-0 border-t border-border relative">
      {/* Navigation bar — all buttons same height (h-7) */}
      <div className="flex items-center px-2 py-2 bg-bg-surface/50 gap-1.5">
        {/* Esc */}
        <button type="button" onClick={() => btn(ESC)} disabled={disabled} className={keyBtnClass}>
          Esc
        </button>

        {/* Switch Mode (Shift+Tab) */}
        <button type="button" onClick={() => btn(SHIFT_TAB)} disabled={disabled} className={keyBtnClass}>
          Switch Mode
        </button>

        {/* Keys popover — arrows | keys | commands + big Record button below.
            Full viewport width so three columns + tall Record fit comfortably on mobile. */}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled} className={keyBtnClass}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              More
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={8}
            collisionPadding={8}
            className="w-[calc(100vw-1rem)] max-w-md p-3"
          >
            <div className="grid grid-cols-3 gap-2 items-start">
              {/* Left: arrow d-pad — always available, even when regex hasn't surfaced arrows */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9px] font-semibold text-text-dim uppercase tracking-wider">Arrows</span>
                <button
                  type="button"
                  onClick={() => btn(ARROW_UP)}
                  disabled={disabled}
                  className="w-9 h-8 flex items-center justify-center rounded-md bg-bg-surface border border-border text-text-muted hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                  aria-label="Arrow up"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => btn(ARROW_LEFT)}
                    disabled={disabled}
                    className="w-9 h-8 flex items-center justify-center rounded-md bg-bg-surface border border-border text-text-muted hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                    aria-label="Arrow left"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => btn(ARROW_DOWN)}
                    disabled={disabled}
                    className="w-9 h-8 flex items-center justify-center rounded-md bg-bg-surface border border-border text-text-muted hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                    aria-label="Arrow down"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => btn(ARROW_RIGHT)}
                    disabled={disabled}
                    className="w-9 h-8 flex items-center justify-center rounded-md bg-bg-surface border border-border text-text-muted hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                    aria-label="Arrow right"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Middle: Tab + Ctrl+C */}
              <div className="flex flex-col items-stretch gap-1">
                <span className="text-[9px] font-semibold text-text-dim uppercase tracking-wider text-center">Keys</span>
                <button
                  type="button"
                  onClick={() => { btn(TAB); setMoreOpen(false); }}
                  disabled={disabled}
                  className="h-8 px-2 rounded-md text-xs font-medium text-text-muted bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                >
                  Tab
                </button>
                <button
                  type="button"
                  onClick={() => { haptics.impactMedium(); onInterrupt(); setMoreOpen(false); }}
                  disabled={disabled}
                  className="h-8 px-2 rounded-md text-xs font-medium text-danger bg-bg-surface border border-danger/40 hover:bg-danger/10 active:bg-danger/10 transition-colors disabled:opacity-30 touch-manipulation"
                >
                  Ctrl+C
                </button>
              </div>

              {/* Right: /resume + /btw */}
              <div className="flex flex-col items-stretch gap-1">
                <span className="text-[9px] font-semibold text-text-dim uppercase tracking-wider text-center">Commands</span>
                <button
                  type="button"
                  onClick={() => {
                    haptics.impactMedium();
                    onSend('/resume\r');
                    setMoreOpen(false);
                  }}
                  disabled={disabled}
                  className="h-8 px-2 rounded-md font-mono text-xs text-primary bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                >
                  /resume
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptics.impactLight();
                    setValue('/btw ');
                    onDraftChange?.('/btw ');
                    setMoreOpen(false);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                  disabled={disabled}
                  className="h-8 px-2 rounded-md font-mono text-xs text-primary bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 touch-manipulation"
                >
                  /btw
                </button>
              </div>
            </div>

            {/* Big Record button below. Closes the More popover and opens the
                header's recording popover (DesktopRecordingControls) so mobile
                and desktop share one Record UI instead of stacking another panel here. */}
            <button
              type="button"
              onClick={() => {
                haptics.impactLight();
                setMoreOpen(false);
                recordingPanelTrigger.open?.();
              }}
              disabled={disabled}
              className="mt-3 w-full h-12 rounded-lg bg-danger/10 border border-danger/40 hover:bg-danger/20 active:bg-danger/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-30 touch-manipulation"
            >
              <svg className="w-5 h-5 text-danger" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
              </svg>
              <span className="text-sm font-medium text-text">Record</span>
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Prompt input area */}
      <div className="px-3 pb-3 pt-2">
        {/* Badge bar for recording tokens */}
        <RecordingBadgeBar
          value={value}
          onValueChange={setValue}
          onBadgeClick={(id) => setPreviewRecordingId(id)}
        />

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onDraftChange?.(e.target.value);
            }}
            onFocus={() => {
              setFocused(true);
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
              }
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            style={{ minHeight: native && focused && !value ? 140 : 44 }}
            className="w-full bg-bg border border-border rounded-lg px-3 text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-[min-height,border-color] duration-200 ease-out resize-none max-h-[200px] py-2.5 flex-1 text-base"
            placeholder={
              disabled
                ? 'Session not active'
                : 'How can I help you?'
            }
            rows={1}
            disabled={disabled}
          />

          {/* Icon-only Stop / Previous / Select / Send button */}
          {showStop ? (
            <button
              type="button"
              onClick={() => { haptics.impactMedium(); onInterrupt(); }}
              disabled={disabled}
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-danger text-white active:bg-danger/80 transition-colors disabled:opacity-30"
              title="Stop"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (() => {
            const showSelect = !!(isSelectionMode && !value.trim());
            const showPrevious = !value && !showSelect;
            if (showPrevious) {
              return (
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  disabled={disabled}
                  className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-bg-surface border border-border text-text-dim hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-30"
                  aria-label="Previous messages"
                  title="Previous messages"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              );
            }
            return (
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                  sendDisabled
                    ? 'bg-bg-surface border border-border text-text-dim'
                    : 'bg-primary text-white active:bg-primary-hover'
                }`}
                title={showSelect ? 'Select' : 'Send'}
              >
                {showSelect ? (
                  /* Checkmark circle for select */
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  /* Up arrow for send */
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
