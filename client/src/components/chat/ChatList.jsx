import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.js';

export default function ChatList({ projectId, project }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const chats = project?.chats || [];

  async function handleNewChat() {
    setCreating(true);
    try {
      const data = await api.post(`/api/projects/${projectId}/chats`, { label: 'New Chat' });
      navigate(`/project/${projectId}/chats/${data.chat.id}`);
    } catch (err) {
      console.error('Failed to create chat:', err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      {chats.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          <h3 className="text-text font-medium mb-1">No chats yet</h3>
          <p className="text-text-muted text-sm mb-4">Start a conversation with Claude Code</p>
        </div>
      ) : (
        chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => navigate(`/project/${projectId}/chats/${chat.id}`)}
            className="card text-left w-full hover:border-border-light transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h4 className="font-medium text-text group-hover:text-primary transition-colors truncate">
                  {chat.label}
                </h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                  <span>{(chat.history || []).length} messages</span>
                  <span className="text-border">·</span>
                  <span>{new Date(chat.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <svg className="w-5 h-5 text-text-dim group-hover:text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
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
