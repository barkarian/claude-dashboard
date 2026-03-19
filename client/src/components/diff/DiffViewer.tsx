import { useMemo } from 'react';
import { parseDiff } from '../../utils/parseDiff.ts';

interface DiffViewerProps {
  diff: string;
  filePath: string;
}

export default function DiffViewer({ diff, filePath }: DiffViewerProps) {
  const hunks = useMemo(() => {
    if (!diff) return [];
    let fullDiff = diff;
    if (!fullDiff.startsWith('diff ') && !fullDiff.startsWith('---')) {
      fullDiff = `--- a/${filePath}\n+++ b/${filePath}\n${fullDiff}`;
    }
    return parseDiff(fullDiff);
  }, [diff, filePath]);

  if (hunks.length === 0) {
    return <div className="p-4 text-text-dim text-sm">No diff available</div>;
  }

  return (
    <div className="diff-viewer text-sm font-mono">
      <table className="w-full border-collapse">
        <tbody>
          {hunks.map((hunk, hi) =>
            hunk.lines.map((line, li) => {
              if (line.type === 'hunk-header') {
                return (
                  <tr key={`${hi}-${li}`} className="bg-primary/10">
                    <td
                      colSpan={3}
                      className="px-3 py-1.5 text-xs text-primary font-semibold sticky left-0"
                    >
                      {line.hunkHeader}
                    </td>
                  </tr>
                );
              }

              const rowBg =
                line.type === 'addition'
                  ? 'bg-green-500/10'
                  : line.type === 'deletion'
                    ? 'bg-red-500/10'
                    : '';

              const prefix =
                line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';

              return (
                <tr key={`${hi}-${li}`} className={rowBg}>
                  <td className={`diff-ln sticky left-0 z-10 w-[2rem] min-w-[2rem] text-right select-none px-1 text-text-dim/50 ${rowBg || 'bg-bg'}`}>
                    {line.oldLine ?? ''}
                  </td>
                  <td className={`diff-ln sticky left-[2rem] z-10 w-[2rem] min-w-[2rem] text-right select-none px-1 text-text-dim/50 border-r border-border/30 ${rowBg || 'bg-bg'}`}>
                    {line.newLine ?? ''}
                  </td>
                  <td className="px-2 whitespace-pre-wrap break-all">
                    <span className={`inline-block w-3 text-center select-none ${
                      line.type === 'addition' ? 'text-green-400' :
                      line.type === 'deletion' ? 'text-red-400' :
                      'text-text-dim/30'
                    }`}>{prefix}</span>
                    {line.content}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
