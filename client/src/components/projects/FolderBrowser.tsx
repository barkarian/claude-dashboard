import { useState, useEffect } from 'react';
import api from '../../utils/api.ts';

interface FolderEntry {
  name: string;
  type: 'directory';
  hasGit: boolean;
}

interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FolderEntry[];
}

interface FolderBrowserProps {
  onSelect: (path: string) => void;
  selectedPath?: string;
  initialPath?: string;
}

export default function FolderBrowser({ onSelect, selectedPath, initialPath }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    browse(currentPath || undefined);
  }, []);

  async function browse(path?: string) {
    setLoading(true);
    setError('');
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : '';
      const data = await api.get<BrowseResponse>(`/api/filesystem/browse${query}`);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setEntries(data.entries);
    } catch (err: any) {
      setError(err.message || 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }

  function handleEntryClick(entryPath: string) {
    // Clicking a directory selects it
    onSelect(entryPath);
  }

  function handleNavigateInto(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    // Also select the directory we're navigating into
    onSelect(path);
    browse(path);
  }

  // Clickable breadcrumb segments
  const pathSegments = currentPath.split('/').filter(Boolean);

  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm overflow-x-auto">
        <button
          onClick={() => browse('/')}
          className="text-text-muted hover:text-primary flex-shrink-0"
        >
          /
        </button>
        {pathSegments.map((seg, i) => {
          const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
          const isLast = i === pathSegments.length - 1;
          return (
            <span key={segPath} className="flex items-center gap-1">
              <span className="text-text-dim">/</span>
              {isLast ? (
                <span className="text-text font-medium truncate">{seg}</span>
              ) : (
                <button
                  onClick={() => browse(segPath)}
                  className="text-text-muted hover:text-primary truncate"
                >
                  {seg}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {error && (
        <div className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {/* Up navigation */}
          {parentPath && (
            <button
              onClick={() => browse(parentPath)}
              className="w-full text-left px-3 py-2.5 hover:bg-bg-hover transition-colors flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              <span className="text-text-muted">..</span>
            </button>
          )}

          {entries.length === 0 && !parentPath ? (
            <div className="text-center py-4 text-text-muted text-sm">Empty directory</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-4 text-text-muted text-sm">No subdirectories</div>
          ) : (
            entries.map((entry) => {
              const entryPath = `${currentPath}/${entry.name}`.replace('//', '/');
              const isSelected = selectedPath === entryPath;
              return (
                <div
                  key={entry.name}
                  onClick={() => handleEntryClick(entryPath)}
                  className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2 text-sm cursor-pointer ${
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-l-primary'
                      : 'hover:bg-bg-hover'
                  }`}
                >
                  <svg className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary' : 'text-primary/70'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-text'}`}>
                    {entry.name}
                  </span>
                  {entry.hasGit && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
                      git
                    </span>
                  )}
                  {/* Arrow to navigate into directory */}
                  <button
                    onClick={(e) => handleNavigateInto(e, entryPath)}
                    className="p-1 rounded hover:bg-bg-hover transition-colors flex-shrink-0"
                    title="Open directory"
                  >
                    <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
