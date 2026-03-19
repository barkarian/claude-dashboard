import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Button } from '../ui/button.tsx';
import FilePicker from './FilePicker.tsx';
import TerminalRecordButton from './TerminalRecordButton.tsx';
import ScriptPickerPanel from './ScriptPickerPanel.tsx';
import RecordingPreviewPanel from './RecordingPreviewPanel.tsx';
import RecordingBadgeBar, { extractRecordingIds } from './RecordingBadgeBar.tsx';
import RecordingContentModal from './RecordingContentModal.tsx';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface PromptInputProps {
  projectId: string;
  onSend: (text: string) => void;
  onCancel?: () => void;
  onSelect?: () => void;
  isThinking?: boolean;
  disabled?: boolean;
  onTextChange?: (newVal: string, oldVal: string) => void;
  onTerminalKey?: (key: string) => void;
}

export default function PromptInput({ projectId, onSend, onCancel, onSelect, isThinking, disabled, onTextChange, onTerminalKey }: PromptInputProps) {
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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleAction();
      return;
    }
    if (e.key === '@') {
      setTimeout(() => {
        setShowFilePicker(true);
        setCursorPosition(textareaRef.current?.selectionStart || 0);
      }, 0);
      return;
    }

    // Forward keyboard shortcuts to the terminal
    if (onTerminalKey) {
      if (e.key === 'Escape') {
        if (showFilePicker) {
          setShowFilePicker(false);
        } else {
          e.preventDefault();
          onTerminalKey('Escape');
        }
        return;
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        onTerminalKey('ShiftTab');
        return;
      }
      if (e.key === 'ArrowUp' && !value) {
        e.preventDefault();
        onTerminalKey('ArrowUp');
        return;
      }
      if (e.key === 'ArrowDown' && !value) {
        e.preventDefault();
        onTerminalKey('ArrowDown');
        return;
      }
    } else if (e.key === 'Escape') {
      setShowFilePicker(false);
    }
  }

  function handleAction() {
    // If in option mode and textarea is empty, confirm the selection
    if (onSelect && !value.trim()) {
      onSelect();
      return;
    }
    // Otherwise send the text
    let trimmed = value.trim();
    if (!trimmed || disabled || isThinking) return;

    // Expand #rec:ID tokens into formatted terminal output
    const recIds = extractRecordingIds(trimmed);
    for (const id of recIds) {
      const content = getRecordingContent(id);
      if (content) {
        trimmed = trimmed.replace(`#rec:${id}`, content);
      }
    }

    onSend(trimmed);
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

  // Button label: "Select" when option mode and textarea empty, otherwise "Send"
  const showSelect = onSelect && !value.trim();
  const actionDisabled = showSelect ? disabled : (!value.trim() || disabled);

  const arrowBtnClass = 'flex items-center justify-center w-8 h-8 rounded-lg bg-bg-surface active:bg-bg-hover hover:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation flex-shrink-0';

  return (
    <div className="relative border-t border-border p-3">
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
        onValueChange={(newVal) => {
          if (onTextChange) onTextChange(newVal, value);
          setValue(newVal);
        }}
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
          onChange={(e) => {
            const newVal = e.target.value;
            if (onTextChange) onTextChange(newVal, value);
            setValue(newVal);
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-bg border border-border rounded-lg px-3 text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none min-h-[42px] max-h-[200px] py-2.5"
          placeholder={disabled ? 'Session not active' : isThinking ? 'Claude is thinking...' : 'Message Claude Code... (@ for files, Cmd+Enter to send)'}
          rows={1}
          disabled={disabled}
        />

        {/* Up/Down arrows — always visible */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onTerminalKey?.('ArrowUp')}
            className={arrowBtnClass}
            aria-label="Arrow Up"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onTerminalKey?.('ArrowDown')}
            className={arrowBtnClass}
            aria-label="Arrow Down"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Action button */}
        {isThinking ? (
          <Button onClick={onCancel} variant="danger" className="flex-shrink-0 py-2.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </Button>
        ) : (
          <Button
            onClick={handleAction}
            disabled={actionDisabled}
            className="flex-shrink-0 py-2.5"
          >
            {showSelect ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Select
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Send
              </>
            )}
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
