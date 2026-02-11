import { useState, useRef, useEffect } from 'react';
import FilePicker from './FilePicker.jsx';
import type { SDKSessionStatus } from '../../../../shared/types/sdk.ts';

interface SDKPromptInputProps {
  projectId: string;
  status: SDKSessionStatus | 'disconnected';
  onSend: (prompt: string) => void;
  onInterrupt: () => void;
}

export default function SDKPromptInput({ projectId, status, onSend, onInterrupt }: SDKPromptInputProps) {
  const [value, setValue] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);

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
    const trimmed = value.trim();
    if (!trimmed || disabled || isStreaming) return;
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

  return (
    <div className="relative border-t border-border p-3">
      {showFilePicker && (
        <div className="absolute bottom-full left-0 right-0 mb-1 px-3">
          <FilePicker
            projectId={projectId}
            onSelect={handleFileSelect}
            onClose={() => setShowFilePicker(false)}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="input resize-none min-h-[42px] max-h-[200px] py-2.5 flex-1"
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
          <button onClick={onInterrupt} className="btn-danger flex-shrink-0 py-2.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="btn-primary flex-shrink-0 py-2.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
