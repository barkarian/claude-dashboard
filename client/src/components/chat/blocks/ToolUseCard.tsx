import { useState } from 'react';
import type { ToolUseBlock } from '../../../../../shared/types/sdk.ts';

interface ToolUseCardProps {
  block: ToolUseBlock;
}

const TOOL_ICONS: Record<string, string> = {
  Read: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  Write: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  Edit: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125',
  Bash: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z',
  Glob: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  Grep: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  WebFetch: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  WebSearch: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
};

function getToolSummary(block: ToolUseBlock): string {
  const { name, input } = block;
  if (name === 'Bash' && input.command) return String(input.command).slice(0, 80);
  if ((name === 'Read' || name === 'Write' || name === 'Edit') && input.file_path) return String(input.file_path);
  if (name === 'Glob' && input.pattern) return String(input.pattern);
  if (name === 'Grep' && input.pattern) return String(input.pattern);
  if (name === 'WebFetch' && input.url) return String(input.url).slice(0, 60);
  if (name === 'WebSearch' && input.query) return String(input.query).slice(0, 60);
  return Object.keys(input).slice(0, 2).map(k => `${k}: ${String(input[k]).slice(0, 30)}`).join(', ') || 'No arguments';
}

const DEFAULT_ICON = 'M11.42 15.17l-5.384-3.19m0 0l-.002-.002L3 9.72l6.42-3.791m0 0l.002-.001L12 4.068l2.578 1.86m0 0l.002.001L21 9.72l-3.034 2.258m0 0l-.002.002-5.384 3.19m0 0L12 15.75l-.58-.58z';

export default function ToolUseCard({ block }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const iconPath = TOOL_ICONS[block.name] || DEFAULT_ICON;
  const summary = getToolSummary(block);

  return (
    <div className="my-2 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
      >
        <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
        <span className="text-xs font-medium text-text">{block.name}</span>
        <span className="text-xs text-text-muted truncate flex-1 font-mono">{summary}</span>
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          <pre className="mt-2 text-xs font-mono text-text-muted overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
