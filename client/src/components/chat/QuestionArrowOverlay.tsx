import { haptics } from '../../utils/haptics.ts';

// ANSI escape sequences
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_RIGHT = '\x1b[C';
const ARROW_LEFT = '\x1b[D';

interface QuestionArrowOverlayProps {
  multiple: boolean;
  onArrow: (data: string) => void;
  disabled?: boolean;
}

export default function QuestionArrowOverlay({ multiple, onArrow, disabled }: QuestionArrowOverlayProps) {
  function btn(seq: string) {
    if (disabled) return;
    haptics.impactLight();
    onArrow(seq);
  }

  const btnBase = 'flex items-center justify-center rounded-lg bg-primary/10 border border-primary/30 text-primary active:bg-primary/20 transition-colors disabled:opacity-30';

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-bg-surface/80 backdrop-blur-sm border-b border-primary/20 md:hidden">
      {/* Label */}
      <span className="text-[10px] font-medium text-primary uppercase tracking-wider mr-1">
        {multiple ? 'Navigate questions' : 'Select option'}
      </span>

      {/* Left arrow — only for multiple questions */}
      {multiple && (
        <button
          type="button"
          onClick={() => btn(ARROW_LEFT)}
          disabled={disabled}
          className={`w-9 h-9 ${btnBase}`}
          title="Previous question"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      )}

      {/* Up / Down column */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => btn(ARROW_UP)}
          disabled={disabled}
          className={`w-9 h-7 ${btnBase}`}
          title="Up"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => btn(ARROW_DOWN)}
          disabled={disabled}
          className={`w-9 h-7 ${btnBase}`}
          title="Down"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Right arrow — only for multiple questions */}
      {multiple && (
        <button
          type="button"
          onClick={() => btn(ARROW_RIGHT)}
          disabled={disabled}
          className={`w-9 h-9 ${btnBase}`}
          title="Next question"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      )}
    </div>
  );
}
