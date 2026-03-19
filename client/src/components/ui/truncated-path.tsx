interface TruncatedPathProps {
  path: string;
  prefix?: string;
  className?: string;
}

/**
 * Displays a path truncated from the left (showing the last characters).
 * Uses CSS direction:rtl trick so the ellipsis appears on the left
 * when the path overflows, showing the most relevant end of the path.
 */
export default function TruncatedPath({ path, prefix, className = '' }: TruncatedPathProps) {
  return (
    <div className={`flex items-center gap-1 text-xs text-text-dim font-mono min-w-0 ${className}`}>
      {prefix && <span className="flex-shrink-0">{prefix}:</span>}
      <span
        className="truncate"
        title={path}
      >
        {path}
      </span>
    </div>
  );
}
