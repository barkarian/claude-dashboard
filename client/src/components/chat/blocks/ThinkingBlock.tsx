import { useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../../../../../shared/types/sdk.ts';

interface ThinkingBlockProps {
  block: ThinkingBlockType;
}

export default function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!block.thinking) return null;

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        Show thinking
      </button>
      {expanded && (
        <div className="mt-1 pl-3 border-l-2 border-text-dim/30">
          <p className="text-xs text-text-muted whitespace-pre-wrap">{block.thinking}</p>
        </div>
      )}
    </div>
  );
}
