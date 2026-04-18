import { useState, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSocket } from '../../context/SocketContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { downloadProjectFile } from '../../utils/downloadFile.ts';

const SIZE_WARN_BYTES = 2 * 1024 * 1024; // 2 MB

const BINARY_EXTENSIONS = new Set([
  'pdf', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'heic', 'avif',
  'mp3', 'wav', 'flac', 'ogg', 'm4a',
  'mp4', 'mov', 'avi', 'mkv', 'webm',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'class', 'jar', 'pyc', 'wasm',
  'db', 'sqlite', 'sqlite3',
]);

function isBinaryByExtension(filePath: string): boolean {
  const ext = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

function looksBinary(content: string): boolean {
  // If the content contains a NUL byte or a high ratio of non-printable chars,
  // treat it as binary regardless of extension.
  if (content.includes('\u0000')) return true;
  const sample = content.length > 4096 ? content.slice(0, 4096) : content;
  if (sample.length === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue; // tab, LF, CR
    if (code < 32 || code === 0xfffd) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.1;
}

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
  const [fileSize, setFileSize] = useState<number | null>(null);
  const binaryByExt = isBinaryByExtension(filePath);

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
    setFileSize(null);

    function handleStat({ filePath: fp, size }: { filePath: string; size: number }) {
      if (fp !== filePath) return;
      setFileSize(size);
      if (size === 0) {
        // Empty file — no need to fetch content
        setContent('');
        setLoading(false);
      } else if (binaryByExt) {
        // Known binary by extension — skip content fetch, show placeholder
        setLoading(false);
      } else if (size > SIZE_WARN_BYTES) {
        setLargeFileSize(size);
        setLoading(false);
      } else {
        // Small text file — fetch content immediately
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
  }, [socket, projectId, filePath, binaryByExt]);

  const language = getLanguage(filePath);
  const { resolved } = useTheme();
  const syntaxTheme = resolved === 'light' ? oneLight : oneDark;
  const lineNumColor = resolved === 'light' ? '#94a3b8' : '#4a5568';

  const isBinary = binaryByExt || (content !== null && looksBinary(content));
  const isEmpty = fileSize === 0 || (content !== null && content.length === 0);

  const handleDownload = useCallback(() => {
    downloadProjectFile(projectId, filePath).catch((err) => {
      console.error('Download failed:', err);
    });
  }, [projectId, filePath]);

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
        <span className="font-mono text-xs text-text-dim truncate flex-1">{filePath}</span>
        <button
          onClick={handleDownload}
          className="flex-shrink-0 p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
          title="Download"
          aria-label="Download file"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
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
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-3 pt-16 px-6 text-center">
            <svg className="w-10 h-10 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-text-muted text-sm">This file is empty</p>
          </div>
        ) : isBinary ? (
          <div className="flex flex-col items-center gap-4 pt-16 px-6 text-center">
            <svg className="w-10 h-10 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <div>
              <p className="text-text font-medium mb-1">Binary file</p>
              <p className="text-text-muted text-sm">
                This file type can't be previewed. Download it to view on your device.
              </p>
            </div>
            <button
              onClick={handleDownload}
              className="px-4 py-2 text-sm rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-medium inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
            </button>
          </div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={syntaxTheme}
            showLineNumbers
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '0.75rem',
              background: 'transparent',
            }}
            lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: lineNumColor }}
          >
            {content || ''}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
