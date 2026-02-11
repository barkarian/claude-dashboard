import { useMemo } from 'react';
import { html } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

interface DiffViewerProps {
  diff: string;
  filePath: string;
}

export default function DiffViewer({ diff, filePath }: DiffViewerProps) {
  const diffHtml = useMemo(() => {
    if (!diff) return '<div class="p-4 text-gray-500">No diff available</div>';

    try {
      // Ensure the diff has proper headers
      let fullDiff = diff;
      if (!fullDiff.startsWith('diff ') && !fullDiff.startsWith('---')) {
        fullDiff = `--- a/${filePath}\n+++ b/${filePath}\n${fullDiff}`;
      }

      return html(fullDiff, {
        drawFileList: false,
        matching: 'lines',
        outputFormat: window.innerWidth < 768 ? 'line-by-line' : 'side-by-side',
        renderNothingWhenEmpty: false,
      });
    } catch (err) {
      console.error('Diff rendering error:', err);
      return `<pre class="p-4 text-sm font-mono whitespace-pre-wrap">${diff.replace(/</g, '&lt;')}</pre>`;
    }
  }, [diff, filePath]);

  return (
    <div
      className="diff-viewer text-sm"
      dangerouslySetInnerHTML={{ __html: diffHtml }}
    />
  );
}
