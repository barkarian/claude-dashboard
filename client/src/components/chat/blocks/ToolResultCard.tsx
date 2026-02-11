import { useState } from 'react';
import type { ToolResultBlock } from '../../../../../shared/types/sdk.ts';

interface ToolResultCardProps {
  block: ToolResultBlock;
}

const MAX_COLLAPSED_LENGTH = 300;

export default function ToolResultCard({ block }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = block.content.length > MAX_COLLAPSED_LENGTH;
  const displayContent = expanded || !isLong
    ? block.content
    : block.content.slice(0, MAX_COLLAPSED_LENGTH) + '...';

  return (
    <div className={`my-1 rounded-lg border overflow-hidden ${
      block.is_error ? 'border-danger/40 bg-danger/5' : 'border-border bg-bg-surface/50'
    }`}>
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          {block.is_error ? (
            <svg className="w-3.5 h-3.5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className={`text-xs font-medium ${block.is_error ? 'text-danger' : 'text-text-muted'}`}>
            {block.is_error ? 'Error' : 'Output'}
          </span>
        </div>
        <pre className="text-xs font-mono text-text-muted whitespace-pre-wrap break-all overflow-x-auto">
          {displayContent}
        </pre>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-xs text-primary hover:text-primary-hover"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
