import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSocket } from '../../context/SocketContext.tsx';

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

  useEffect(() => {
    if (!socket) return;

    setLoading(true);
    setError(null);
    setContent(null);

    function handleContent({ filePath: fp, content: c }: { filePath: string; content: string }) {
      if (fp === filePath) {
        setContent(c);
        setLoading(false);
      }
    }

    function handleError({ error: err }: { error: string }) {
      setError(err);
      setLoading(false);
    }

    socket.on('files:content', handleContent);
    socket.on('files:error', handleError);
    socket.emit('files:content', { projectId, filePath });

    return () => {
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
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
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
