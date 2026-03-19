import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react';
import { Card } from '../ui/card.tsx';
import { Button } from '../ui/button.tsx';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.ts';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../ui/alert-dialog.tsx';
import api from '../../utils/api.ts';
import type { Project, Chat } from '../../../../shared/types/models.ts';

const PAGE_SIZE = 20;

interface ChatListProps {
  projectId: string;
  project: Project;
  sessionStatuses?: Record<string, string>;
}

export default function ChatList({ projectId, project, sessionStatuses = {} }: ChatListProps) {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { refreshProject } = useProject();
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);

  // Paginated state
  const [chats, setChats] = useState<Chat[]>([]);
  const [total, setTotal] = useState(0);
  const offsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch chats (initial or on search change)
  useEffect(() => {
    loadChats(true);
  }, [projectId, debouncedSearch]);

  async function loadChats(reset: boolean) {
    const currentOffset = reset ? 0 : offsetRef.current;
    if (!reset) setLoadingMore(true);
    if (reset) {
      setInitialLoading(true);
      setHasMore(false);
    }

    try {
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
      const data = await api.get<{ chats: Chat[]; total: number }>(
        `/api/projects/${projectId}/chats?limit=${PAGE_SIZE}&offset=${currentOffset}${searchParam}`
      );
      const newChats = data.chats || [];
      if (reset) {
        setChats(newChats);
      } else {
        setChats(prev => [...prev, ...newChats]);
      }
      const newOffset = currentOffset + newChats.length;
      setTotal(data.total || 0);
      offsetRef.current = newOffset;
      setHasMore(newOffset < (data.total || 0));
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
      setInitialLoading(false);
    }
  }

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadChats(false);
    }
  }, [loadingMore, hasMore, projectId, debouncedSearch]);

  const { sentinelRef } = useInfiniteScroll({ loadMore, hasMore, loading: loadingMore });

  async function handleNewChat() {
    setCreating(true);
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${projectId}/chats`, { label: 'New Chat' });
      navigate(`/project/${projectId}/chats/${data.chat.id}`);
    } catch (err) {
      console.error('Failed to create chat:', err);
    } finally {
      setCreating(false);
    }
  }

  function promptDelete(chat: Chat, e: MouseEvent) {
    e.stopPropagation();
    setDeleteTarget(chat);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      if (sessionStatuses[deleteTarget.id] && socket) {
        socket.emit('sdk:end', { chatId: deleteTarget.id });
      }
      await api.delete(`/api/projects/${projectId}/chats/${deleteTarget.id}`);
      setChats(prev => prev.filter(c => c.id !== deleteTarget.id));
      setTotal(prev => prev - 1);
      refreshProject();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
    setDeleteTarget(null);
  }

  const showSearch = chats.length > 0 || searchQuery;

  return (
    <div className="p-4 space-y-3">
      {/* Search input */}
      {showSearch && (
        <div className="relative">
          <svg className="w-4 h-4 text-text-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-bg-surface border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-primary transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {initialLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : chats.length === 0 && !searchQuery ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          <h3 className="text-text font-medium mb-1">No chats yet</h3>
          <p className="text-text-muted text-sm mb-4">Start a conversation with Claude Code</p>
        </div>
      ) : chats.length === 0 && searchQuery ? (
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No matching chats</p>
        </div>
      ) : (
        <>
          {chats.map((chat) => (
            <Card
              key={chat.id}
              className="text-left w-full hover:border-border-light transition-all group cursor-pointer"
              onClick={() => navigate(`/project/${projectId}/chats/${chat.id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h4 className="font-medium text-text group-hover:text-primary transition-colors truncate">
                    {chat.label}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                    <span>{(chat.history || []).length} messages</span>
                    <span className="text-border">&middot;</span>
                    <span>{new Date(chat.createdAt).toLocaleDateString()}</span>
                    {sessionStatuses[chat.id] && (
                      <>
                        <span className="text-border">&middot;</span>
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          {sessionStatuses[chat.id] === 'thinking'
                            ? 'Thinking...'
                            : sessionStatuses[chat.id] === 'waiting-input'
                              ? 'Waiting input'
                              : sessionStatuses[chat.id] === 'starting'
                                ? 'Starting...'
                                : 'Active'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={(e) => promptDelete(chat, e)}
                    className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-bg-hover transition-all"
                    aria-label="Delete chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                  <svg className="w-5 h-5 text-text-dim group-hover:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </Card>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} />
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </>
      )}

      <Button onClick={handleNewChat} disabled={creating} variant="outline" className="w-full">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {creating ? 'Creating...' : 'New Chat'}
      </Button>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.label}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-danger hover:bg-danger/90 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
