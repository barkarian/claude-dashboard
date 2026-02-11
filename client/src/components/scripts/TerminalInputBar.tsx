import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { useAIGenerate } from '../../hooks/useAIGenerate.ts';

interface TerminalInputBarProps {
  onSend: (data: string) => void;
  disabled?: boolean;
  projectId?: string;
}

export default function TerminalInputBar({ onSend, disabled = false, projectId }: TerminalInputBarProps) {
  const [value, setValue] = useState('');
  const [aiMode, setAiMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { isGenerating, step, result, error, generateCommand, cancel, reset } = useAIGenerate();

  // When AI result arrives, place it in the input and exit AI mode
  useEffect(() => {
    if (result && typeof result === 'string') {
      setValue(result);
      setAiMode(false);
      reset();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [result, reset]);

  // Clean up AI session on unmount
  useEffect(() => {
    return () => {
      if (isGenerating) cancel();
    };
  }, [isGenerating, cancel]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;

    if (aiMode && !isGenerating) {
      // In AI mode: send description to AI
      if (projectId) {
        generateCommand(projectId, value.trim());
      }
    } else if (!aiMode && !disabled) {
      // Normal mode: send to terminal
      onSend(value + '\r');
      setValue('');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (aiMode) {
      // Escape exits AI mode
      if (e.key === 'Escape') {
        e.preventDefault();
        exitAiMode();
      }
      return;
    }
    // Normal terminal shortcuts
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      onSend('\x03');
      setValue('');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onSend('\t');
    }
  }

  function toggleAiMode() {
    if (isGenerating) {
      cancel();
      return;
    }
    if (aiMode) {
      exitAiMode();
    } else {
      setAiMode(true);
      setValue('');
      reset();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function exitAiMode() {
    if (isGenerating) cancel();
    setAiMode(false);
    setValue('');
    reset();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-surface flex-shrink-0"
    >
      {/* Left icon: $ for normal, sparkle for AI */}
      {aiMode ? (
        <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      ) : (
        <span className="text-text-dim font-mono text-sm select-none flex-shrink-0">$</span>
      )}

      {/* Input field or generating status */}
      {isGenerating ? (
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <div className="flex gap-1 flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-xs text-text-muted truncate">{step}</span>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!aiMode && disabled}
          placeholder={
            aiMode
              ? 'Describe what command you need...'
              : disabled
                ? 'Process not running'
                : 'Type a command...'
          }
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-text-dim ${
            aiMode ? 'text-primary' : 'text-text font-mono'
          }`}
        />
      )}

      {/* AI toggle button */}
      {projectId && (
        <button
          type="button"
          onClick={toggleAiMode}
          disabled={!aiMode && disabled}
          className={`p-1.5 rounded-md transition-colors flex-shrink-0 disabled:opacity-30 disabled:pointer-events-none ${
            aiMode || isGenerating
              ? 'text-primary bg-primary/10'
              : 'text-text-muted hover:text-primary hover:bg-bg-hover'
          }`}
          title={isGenerating ? 'Cancel AI' : aiMode ? 'Exit AI mode' : 'AI command (describe what to run)'}
        >
          {isGenerating ? (
            /* X icon to cancel */
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            /* Sparkle icon */
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          )}
        </button>
      )}

      {/* Send button */}
      <button
        type="submit"
        disabled={isGenerating || (!aiMode && disabled) || !value.trim()}
        className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:pointer-events-none flex-shrink-0"
        title={aiMode ? 'Generate' : 'Send'}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
        </svg>
      </button>
    </form>
  );
}
