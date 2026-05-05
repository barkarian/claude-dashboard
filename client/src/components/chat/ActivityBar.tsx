interface ActivityBarProps {
  /** "Reading foo.ts", "Thinking…", etc. Falsy hides the bar. */
  label: string | null | undefined;
}

/** Slim bar shown between the message list and the input while the agent
 *  is working — surfaces what's happening (tool, thinking, retry) instead
 *  of a contentless three-dots indicator. */
export default function ActivityBar({ label }: ActivityBarProps) {
  if (!label) return null;
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border-t border-border bg-bg-surface/60">
      <span
        className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
        aria-hidden
      />
      <span className="text-xs text-text-muted truncate">{label}</span>
    </div>
  );
}
