import { useState, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSocket } from '../../context/SocketContext.tsx';

const SIZE_WARN_BYTES = 2 * 1024 * 1024; // 2 MB

const extToLanguage: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
  kt: 'kotlin', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', graphql: 'graphql', md: 'markdown',
  dockerfile: 'docker', makefile: 'makefile',
};

function getLanguage(filePath: string): string {
  const basename = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (basename === 'dockerfile') return 'docker';
  if (basename === 'makefile') return 'makefile';
  const ext = basename.split('.').pop() ?? '';
  return extToLanguage[ext] || 'text';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileContentViewProps {
  projectId: string;
  filePath: string;
  onBack: () => void;
}

export default function FileContentView({ projectId, filePath, onBack }: FileContentViewProps) {
  const { socket } = useSocket();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [largeFileSize, setLargeFileSize] = useState<number | null>(null);

  const fetchContent = useCallback(() => {
    if (!socket) return;
    setLargeFileSize(null);
    setLoading(true);
    setError(null);
    setContent(null);
    socket.emit('files:content', { projectId, filePath });
  }, [socket, projectId, filePath]);

  useEffect(() => {
    if (!socket) return;

    setLoading(true);
    setError(null);
    setContent(null);
    setLargeFileSize(null);

    function handleStat({ filePath: fp, size }: { filePath: string; size: number }) {
      if (fp !== filePath) return;
      if (size > SIZE_WARN_BYTES) {
        setLargeFileSize(size);
        setLoading(false);
      } else {
        // Small file — fetch content immediately
        socket!.emit('files:content', { projectId, filePath });
      }
    }

    function handleContent({ filePath: fp, content: c }: { filePath: string; content: string }) {
      if (fp !== filePath) return;
      setContent(c);
      setLoading(false);
    }

    function handleError({ error: err }: { error: string }) {
      setError(err);
      setLoading(false);
    }

    socket.on('files:stat', handleStat);
    socket.on('files:content', handleContent);
    socket.on('files:error', handleError);

    // Start with stat check
    socket.emit('files:stat', { projectId, filePath });

    return () => {
      socket.off('files:stat', handleStat);
      socket.off('files:content', handleContent);
      socket.off('files:error', handleError);
    };
  }, [socket, projectId, filePath]);

  const language = getLanguage(filePath);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-text-muted hover:text-text"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <span className="font-mono text-xs text-text-dim truncate">{filePath}</span>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center pt-12">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : largeFileSize !== null && content === null ? (
          <div className="flex flex-col items-center gap-4 pt-16 px-6 text-center">
            <svg className="w-10 h-10 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-text font-medium mb-1">Large file ({formatSize(largeFileSize)})</p>
              <p className="text-text-muted text-sm">
                Fetching this file will transfer {formatSize(largeFileSize)} through the tunnel and count against your bandwidth.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="px-4 py-2 text-sm rounded-lg bg-bg-surface border border-border text-text-muted hover:text-text transition-colors"
              >
                Go back
              </button>
              <button
                onClick={fetchContent}
                className="px-4 py-2 text-sm rounded-lg bg-warning/20 text-warning hover:bg-warning/30 transition-colors font-medium"
              >
                Fetch anyway
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-danger">{error}</div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '0.75rem',
              background: 'transparent',
            }}
            lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#4a5568' }}
          >
            {content || ''}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
