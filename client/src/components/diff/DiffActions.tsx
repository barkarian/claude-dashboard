import { Button } from '../ui/button.tsx';
import { haptic } from '../../utils/platform.ts';

interface DiffActionsProps {
  filePath: string;
  onRevert?: () => void;
  onAccept?: () => void;
}

export default function DiffActions({ filePath, onRevert, onAccept }: DiffActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {onRevert && (
        <Button
          onClick={() => { haptic('warning'); onRevert(); }}
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          Revert
        </Button>
      )}
      {onAccept && (
        <Button
          onClick={() => { haptic('success'); onAccept!(); }}
          variant="ghost"
          size="sm"
          className="text-success hover:bg-success/10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Accept
        </Button>
      )}
    </div>
  );
}
