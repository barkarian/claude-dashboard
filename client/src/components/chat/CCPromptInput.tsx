import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import { haptics } from '../../utils/haptics.ts';
import { isCapacitorNative } from '../../utils/platform.ts';
import TerminalRecordButton from './TerminalRecordButton.tsx';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingPreviewPanel from './RecordingPreviewPanel.tsx';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface CCPromptInputProps {
  projectId: string;
  status: 'disconnected' | 'running' | 'exited' | 'error';
  onSend: (data: string) => void;
  onArrow: (data: string) => void;
  onInterrupt: () => void;
  autoFocus?: boolean;
  promptSuggestion?: { text: string; id: number } | null;
}

// ANSI escape sequences
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_RIGHT = '\x1b[C';
const ARROW_LEFT = '\x1b[D';
const ESC = '\x1b';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';

export default function CCPromptInput({ projectId, status, onSend, onArrow, onInterrupt, autoFocus, promptSuggestion }: CCPromptInputProps) {
  const [value, setValue] = useState('');
  const [showSwipeInfo, setShowSwipeInfo] = useState(false);
  const [swipeInfoDismissed, setSwipeInfoDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Recording state
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewRecordingId, setPreviewRecordingId] = useState<string | null>(null);
  const { activeRecording, stopRecording, getRecordingContent } = useTerminalRecording();

  // Sync prompt suggestion from terminal history (arrow up/down) into textarea
  const lastSuggestionIdRef = useRef(-1);
  useEffect(() => {
    if (promptSuggestion && promptSuggestion.id !== lastSuggestionIdRef.current) {
      lastSuggestionIdRef.current = promptSuggestion.id;
      setValue(promptSuggestion.text);
    }
  }, [promptSuggestion]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
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
      onArrow(ESC);
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

  const btnBase = 'flex items-center justify-center rounded bg-bg-surface border border-border text-text-muted hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30';

  return (
    <div className="flex-shrink-0 border-t border-border relative">
      {/* Recording popups above input */}
      {showScriptPicker && !activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-10">
          <ScriptPickerPanel
            projectId={projectId}
            onClose={() => setShowScriptPicker(false)}
            onStarted={() => setShowLivePreview(true)}
          />
        </div>
      )}

      {showLivePreview && activeRecording && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3 z-10">
          <RecordingPreviewPanel
            onClose={() => setShowLivePreview(false)}
            onStop={handleStopAndInsert}
          />
        </div>
      )}

      {/* Capacitor swipe info overlay */}
      {native && showSwipeInfo && !swipeInfoDismissed && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 z-10">
          <div className="bg-bg-surface border border-border rounded-lg p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-2 text-xs text-text-muted">
                <p className="font-medium text-text text-sm">Swipe gestures</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                    Swipe up = Arrow Up
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    Swipe down = Arrow Down
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                    Swipe left = Arrow Left
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    Swipe right = Arrow Right
                  </span>
                </div>
                <p className="text-text-dim">Swipe anywhere on the terminal to navigate menus and selections.</p>
              </div>
              <button
                onClick={() => { setShowSwipeInfo(false); setSwipeInfoDismissed(true); }}
                className="flex-shrink-0 p-1 rounded hover:bg-bg-hover text-text-dim"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation bar */}
      <div className="flex items-center px-2 py-1.5 bg-bg-surface/50">
        {/* Left: Keys popover (Esc, Tab, Shift+Tab, ^C) */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="px-2 py-1.5 rounded text-[11px] font-medium text-text-muted bg-bg-surface border border-border hover:bg-bg-hover active:bg-bg-hover transition-colors disabled:opacity-30 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              Keys
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="p-1.5 min-w-[140px]">
            <button
              onClick={() => btn(ESC)}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Esc
            </button>
            <button
              onClick={() => btn(TAB)}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Tab
            </button>
            <button
              onClick={() => btn(SHIFT_TAB)}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Shift+Tab
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => { haptics.impactMedium(); onInterrupt(); }}
              disabled={disabled}
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-bg-hover transition-colors text-danger disabled:opacity-30"
            >
              Ctrl+C
            </button>
          </PopoverContent>
        </Popover>

        {/* Center: Arrow keys */}
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <button type="button" onClick={() => btn(ARROW_LEFT)} disabled={disabled} className={`w-7 h-7 ${btnBase}`} title="Left">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex flex-col gap-0.5">
            <button type="button" onClick={() => btn(ARROW_UP)} disabled={disabled} className={`w-7 h-5 ${btnBase}`} title="Up">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => btn(ARROW_DOWN)} disabled={disabled} className={`w-7 h-5 ${btnBase}`} title="Down">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
          <button type="button" onClick={() => btn(ARROW_RIGHT)} disabled={disabled} className={`w-7 h-7 ${btnBase}`} title="Right">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>

        {/* Right: Enter + info icon */}
        <div className="flex items-center gap-1">
          {native && !swipeInfoDismissed && (
            <button
              type="button"
              onClick={() => setShowSwipeInfo(prev => !prev)}
              className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:text-primary hover:bg-bg-hover transition-colors"
              title="Swipe gesture info"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => btn('\r')}
            disabled={disabled}
            className="px-3 py-1.5 rounded text-[11px] font-semibold text-primary bg-primary/10 border border-primary/30 hover:bg-primary/20 active:bg-primary/20 transition-colors disabled:opacity-30"
            title="Enter"
          >
            Enter
          </button>
        </div>
      </div>

      {/* Prompt input area */}
      <div className="p-3 pt-2">
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
                : 'Message Claude Code... (Enter to send)'
            }
            rows={1}
            disabled={disabled}
          />

          <Button
            onClick={handleSend}
            disabled={disabled}
            className="flex-shrink-0 py-2.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </Button>
        </div>
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
