import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useSearch } from '../../context/SearchContext.tsx';

export default function SearchOverlay() {
  const { isOpen, close, handler } = useSearch();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Incremental search as user types
  useEffect(() => {
    if (!handler || !isOpen) return;
    if (query) {
      handler.findNext(query, true);
    } else {
      handler.clearSearch();
    }
  }, [query, handler, isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!query) return;
      if (e.shiftKey) {
        handler?.findPrevious(query);
      } else {
        handler?.findNext(query, false);
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <div className="absolute top-2 right-4 z-50 hidden md:flex items-center gap-1 bg-bg-surface border border-border rounded-lg shadow-lg px-3 py-1.5">
      <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page..."
        className="w-48 text-sm bg-transparent text-text placeholder:text-text-dim focus:outline-none ml-1"
      />
      <button
        onClick={() => handler?.findPrevious(query)}
        disabled={!query}
        className="p-1 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30 disabled:cursor-default"
        title="Previous match (Shift+Enter)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        </svg>
      </button>
      <button
        onClick={() => handler?.findNext(query, false)}
        disabled={!query}
        className="p-1 rounded hover:bg-bg-hover text-text-muted disabled:opacity-30 disabled:cursor-default"
        title="Next match (Enter)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={close}
        className="p-1 rounded hover:bg-bg-hover text-text-muted"
        title="Close (Escape)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
