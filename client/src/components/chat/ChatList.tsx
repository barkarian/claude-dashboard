import { useState, useEffect, type MouseEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import api from '../../utils/api.ts';
import type { Project, Chat } from '../../../../shared/types/models.ts';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const chats = project?.chats || [];

  // On mount, hit the chats endpoint which cleans up empty "New Chat" entries server-side
  useEffect(() => {
    api.get(`/api/projects/${projectId}/chats`).then(() => {
      refreshProject();
    }).catch(() => {});
  }, [projectId]);

  const filteredChats = chats
    .filter((c) => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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

  function startEditing(chat: Chat, e: MouseEvent) {
    e.stopPropagation();
    setEditingId(chat.id);
    setEditLabel(chat.label);
  }

  async function saveLabel(chatId: string) {
    const trimmed = editLabel.trim();
    if (!trimmed) return;
    try {
      await api.patch(`/api/projects/${projectId}/chats/${chatId}`, { label: trimmed });
      await refreshProject();
    } catch (err) {
      console.error('Failed to rename chat:', err);
    }
    setEditingId(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditLabel('');
  }

  function handleEditKeyDown(e: KeyboardEvent, chatId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLabel(chatId);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  }

  async function handleDelete(chatId: string, e: MouseEvent) {
    e.stopPropagation();
    try {
      if (sessionStatuses[chatId] && socket) {
        socket.emit('sdk:end', { chatId });
      }
      await api.delete(`/api/projects/${projectId}/chats/${chatId}`);
      await refreshProject();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }

  return (
    <div className="p-4 space-y-3">
      {/* Search input — hidden when no chats */}
      {chats.length > 0 && (
        <div className="relative">
          <svg className="w-4 h-4 text-text-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-surface border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      )}

      {chats.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          <h3 className="text-text font-medium mb-1">No chats yet</h3>
          <p className="text-text-muted text-sm mb-4">Start a conversation with Claude Code</p>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No matching chats</p>
        </div>
      ) : (
        filteredChats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => editingId !== chat.id && navigate(`/project/${projectId}/chats/${chat.id}`)}
            className="card text-left w-full hover:border-border-light transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                {editingId === chat.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => handleEditKeyDown(e, chat.id)}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-sm bg-bg-surface border border-primary rounded text-text focus:outline-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); saveLabel(chat.id); }}
                      className="text-xs text-primary hover:text-primary/80 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                      className="text-xs text-text-muted hover:text-text font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h4 className="font-medium text-text group-hover:text-primary transition-colors truncate">
                    {chat.label}
                  </h4>
                )}
                <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                  <span>{(chat.history || []).length} messages</span>
                  <span className="text-border">·</span>
                  <span>{new Date(chat.createdAt).toLocaleDateString()}</span>
                  {sessionStatuses[chat.id] && (
                    <>
                      <span className="text-border">·</span>
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
                {editingId !== chat.id && (
                  <>
                    <button
                      onClick={(e) => startEditing(chat, e)}
                      className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:text-text-muted hover:bg-bg-hover transition-all"
                      aria-label="Rename chat"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => handleDelete(chat.id, e)}
                      className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-bg-hover transition-all"
                      aria-label="Delete chat"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </>
                )}
                <svg className="w-5 h-5 text-text-dim group-hover:text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </div>
          </button>
        ))
      )}

      <button onClick={handleNewChat} disabled={creating} className="btn-outline w-full">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {creating ? 'Creating...' : 'New Chat'}
      </button>
    </div>
  );
}
