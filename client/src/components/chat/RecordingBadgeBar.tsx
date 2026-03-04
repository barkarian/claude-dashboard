import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';

interface RecordingBadgeBarProps {
  value: string;
  onValueChange: (newValue: string) => void;
  onBadgeClick: (recordingId: string) => void;
}

const REC_TOKEN_REGEX = /#rec:(\d{4})/g;

export function extractRecordingIds(text: string): string[] {
  const ids: string[] = [];
  let match;
  const re = new RegExp(REC_TOKEN_REGEX.source, 'g');
  while ((match = re.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

export default function RecordingBadgeBar({ value, onValueChange, onBadgeClick }: RecordingBadgeBarProps) {
  const { recordings } = useTerminalRecording();
  const ids = extractRecordingIds(value);

  if (ids.length === 0) return null;

  function handleRemove(id: string) {
    const newValue = value.replace(new RegExp(`\\s*#rec:${id}\\s*`, 'g'), ' ').trim();
    onValueChange(newValue);
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-2">
      {ids.map(id => {
        const rec = recordings.get(id);
        const lineCount = rec ? rec.lines.length : 0;
        return (
          <span
            key={id}
            className="badge-recording inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs cursor-pointer"
            onClick={() => onBadgeClick(id)}
          >
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="3" />
            </svg>
            <span className="font-medium">Terminal Record</span>
            {lineCount > 0 && <span className="text-[10px] opacity-70">({lineCount} lines)</span>}
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(id); }}
              className="ml-0.5 p-0.5 rounded hover:bg-white/10 transition-colors"
              aria-label="Remove recording"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        );
      })}
    </div>
  );
}
