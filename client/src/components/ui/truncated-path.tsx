interface TruncatedPathProps {
  path: string;
  prefix?: string;
  className?: string;
}

/**
 * Displays a path truncated from the left (showing the last characters).
 * Uses CSS direction:rtl + text-overflow so the ellipsis appears at the
 * start when the path overflows, keeping the filename visible.
 */
export default function TruncatedPath({ path, prefix, className = '' }: TruncatedPathProps) {
  return (
    <div className={`flex items-center gap-1 text-xs text-text-dim font-mono min-w-0 ${className}`}>
      {prefix && <span className="flex-shrink-0">{prefix}:</span>}
      <span
        className="block min-w-0 overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ direction: 'rtl', textAlign: 'left' }}
        title={path}
      >
        {/* Wrap in ltr embed so slashes/dots render correctly inside the rtl container */}
        <bdi>{path}</bdi>
      </span>
    </div>
  );
}
