import { useState } from 'react';

function ArrowPad({ onKey }) {
  const btnBase = 'flex items-center justify-center w-11 h-11 rounded-lg bg-bg-surface active:bg-bg-hover text-text transition-colors select-none touch-manipulation';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex justify-center">
        <button className={btnBase} onClick={() => onKey('ArrowUp')} aria-label="Up">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
      <div className="flex gap-1">
        <button className={btnBase} onClick={() => onKey('ArrowLeft')} aria-label="Left">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary/20 active:bg-primary/40 text-primary font-bold text-xs transition-colors select-none touch-manipulation"
          onClick={() => onKey('Enter')}
          aria-label="Enter"
        >
          OK
        </button>
        <button className={btnBase} onClick={() => onKey('ArrowRight')} aria-label="Right">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="flex justify-center">
        <button className={btnBase} onClick={() => onKey('ArrowDown')} aria-label="Down">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      <div className="flex gap-1 mt-1">
        <button
          className="px-3 py-1.5 rounded-md bg-bg-surface active:bg-bg-hover text-text-muted text-xs transition-colors select-none touch-manipulation"
          onClick={() => onKey('Escape')}
        >
          Esc
        </button>
        <button
          className="px-3 py-1.5 rounded-md bg-bg-surface active:bg-bg-hover text-text-muted text-xs transition-colors select-none touch-manipulation"
          onClick={() => onKey('Tab')}
        >
          Tab
        </button>
      </div>
    </div>
  );
}

function SelectionMenuControls({ state, onKey }) {
  function handleSelect(idx) {
    const current = state.selectedIndex;
    const diff = idx - current;
    const direction = diff > 0 ? 'ArrowDown' : 'ArrowUp';
    const steps = Math.abs(diff);

    // Navigate to the option, then press Enter
    let delay = 0;
    for (let i = 0; i < steps; i++) {
      setTimeout(() => onKey(direction), delay);
      delay += 80;
    }
    setTimeout(() => onKey('Enter'), delay);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-text-muted font-medium px-1">Select an option:</span>
      <div className="flex flex-col gap-1">
        {state.options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => handleSelect(idx)}
            className={`text-left px-3 py-2 rounded-lg text-sm transition-colors select-none touch-manipulation ${
              idx === state.selectedIndex
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-bg-surface text-text hover:bg-bg-hover active:bg-bg-hover'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function PermissionControls({ state, onKey, onText }) {
  function handleOption(option) {
    const lower = option.toLowerCase();
    if (lower.includes('always')) {
      onText('a');
    } else if (lower.includes('allow') || lower === 'yes') {
      onText('y');
    } else if (lower.includes('deny') || lower === 'no') {
      onText('n');
    } else {
      onText(option);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-text-muted font-medium px-1">Permission required:</span>
      <div className="flex flex-wrap gap-2">
        {state.options.map((option, idx) => {
          const lower = option.toLowerCase();
          const isAllow = lower.includes('allow') || lower === 'yes';
          const isDeny = lower.includes('deny') || lower === 'no';

          let colorClass = 'bg-bg-surface text-text hover:bg-bg-hover active:bg-bg-hover';
          if (isAllow) colorClass = 'bg-success/20 text-success active:bg-success/40';
          if (isDeny) colorClass = 'bg-danger/20 text-danger active:bg-danger/40';

          return (
            <button
              key={idx}
              onClick={() => handleOption(option)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors select-none touch-manipulation ${colorClass}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiOptionControls({ state, onText }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-text-muted font-medium px-1">Choose an option:</span>
      <div className="flex flex-wrap gap-2">
        {state.options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => onText(option)}
            className="px-4 py-2 rounded-lg bg-bg-surface text-text text-sm font-medium hover:bg-bg-hover active:bg-bg-hover transition-colors select-none touch-manipulation"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function SimpleConfirmationControls({ onText }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onText('y')}
        className="px-4 py-2 rounded-lg bg-success/20 text-success text-sm font-medium active:bg-success/40 transition-colors select-none touch-manipulation"
      >
        Yes
      </button>
      <button
        onClick={() => onText('n')}
        className="px-4 py-2 rounded-lg bg-danger/20 text-danger text-sm font-medium active:bg-danger/40 transition-colors select-none touch-manipulation"
      >
        No
      </button>
    </div>
  );
}

function TextInputControls({ state, onText }) {
  const [value, setValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (value.trim()) {
      onText(value);
      setValue('');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      {state.prompt && (
        <span className="text-xs text-text-muted font-medium px-1">{state.prompt}</span>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-surface border border-border text-text text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Type your response..."
          autoFocus
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium active:bg-primary/80 transition-colors select-none touch-manipulation"
        >
          Send
        </button>
      </div>
    </form>
  );
}

export default function InteractiveControls({ interactiveState, onKeyPress, onTextResponse }) {
  if (!interactiveState) return null;

  const { type } = interactiveState;

  return (
    <div className="px-4 py-3 border-t border-border bg-bg-main">
      <div className="flex gap-4 items-start">
        {/* Contextual controls */}
        <div className="flex-1 min-w-0">
          {type === 'selection-menu' && (
            <SelectionMenuControls state={interactiveState} onKey={onKeyPress} />
          )}
          {type === 'permission-prompt' && (
            <PermissionControls state={interactiveState} onKey={onKeyPress} onText={onTextResponse} />
          )}
          {type === 'multi-option-confirmation' && (
            <MultiOptionControls state={interactiveState} onText={onTextResponse} />
          )}
          {type === 'simple-confirmation' && (
            <SimpleConfirmationControls onText={onTextResponse} />
          )}
          {type === 'text-input' && (
            <TextInputControls state={interactiveState} onText={onTextResponse} />
          )}
        </div>

        {/* Arrow d-pad — always visible */}
        <div className="flex-shrink-0">
          <ArrowPad onKey={onKeyPress} />
        </div>
      </div>
    </div>
  );
}
