import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react';

interface TerminalInputBarProps {
  onSend: (data: string) => void;
  disabled?: boolean;
}

export default function TerminalInputBar({ onSend, disabled = false }: TerminalInputBarProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value && !disabled) return;
    onSend(value + '\r');
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      onSend('\x03');
      setValue('');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onSend('\t');
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-surface flex-shrink-0"
    >
      <span className="text-text-dim font-mono text-sm select-none">$</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? 'Process not running' : 'Type a command...'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="flex-1 bg-transparent text-text font-mono text-sm outline-none placeholder:text-text-dim"
      />
      <button
        type="submit"
        disabled={disabled}
        className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:pointer-events-none"
        title="Send"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
        </svg>
      </button>
    </form>
  );
}
