import { useState, useEffect, useRef } from 'react';
import Fuse from 'fuse.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { getFileIcon } from '../../utils/fileIcons.js';

export default function FilePicker({ projectId, onSelect, onClose }) {
  const { socket } = useSocket();
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  const fuseRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();

    if (socket) {
      socket.emit('files:list', { projectId });
      socket.once('files:list', ({ files: fileList }) => {
        setFiles(fileList);
        fuseRef.current = new Fuse(fileList, {
          threshold: 0.4,
          distance: 100,
        });
        setResults(fileList.slice(0, 20));
      });
    }
  }, [socket, projectId]);

  useEffect(() => {
    if (!search.trim()) {
      setResults(files.slice(0, 20));
      return;
    }
    if (fuseRef.current) {
      const matches = fuseRef.current.search(search).slice(0, 20);
      setResults(matches.map(m => m.item));
    }
  }, [search, files]);

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className="card max-h-64 overflow-hidden flex flex-col shadow-xl border-border-light">
      <div className="p-2 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="input text-sm py-1.5"
          placeholder="Search files..."
        />
      </div>
      <div className="overflow-y-auto">
        {results.length === 0 ? (
          <div className="p-3 text-sm text-text-muted text-center">No files found</div>
        ) : (
          results.map((file) => (
            <button
              key={file}
              onClick={() => onSelect(file)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-2"
            >
              <span className="text-xs">{getFileIcon(file)}</span>
              <span className="font-mono text-xs text-text truncate">{file}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
