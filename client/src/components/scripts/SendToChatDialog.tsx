import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import api from '../../utils/api.ts';
import type { Chat } from '../../../../shared/types/models.ts';

interface SendToChatDialogProps {
  projectId: string;
  content: string;
  contentLabel: string;
  onClose: () => void;
}

export default function SendToChatDialog({ projectId, content, contentLabel, onClose }: SendToChatDialogProps) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<Fuse<Chat> | null>(null);

  const formattedContent = `[Terminal Output: ${contentLabel}]\n\`\`\`\n${content}\n\`\`\``;

  useEffect(() => {
    inputRef.current?.focus();
    loadChats();
  }, []);

  async function loadChats() {
    try {
      const data = await api.get<{ chats: Chat[] }>(`/api/projects/${projectId}/chats?limit=50&offset=0`);
      const chatList = data.chats || [];
      setChats(chatList);
      setResults(chatList.slice(0, 20));
      fuseRef.current = new Fuse(chatList, {
        keys: ['label'],
        threshold: 0.4,
        distance: 100,
      });
    } catch (err) {
      console.error('Failed to load chats:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!search.trim()) {
      setResults(chats.slice(0, 20));
      return;
    }
    if (fuseRef.current) {
      const matches = fuseRef.current.search(search).slice(0, 20);
      setResults(matches.map(m => m.item));
    }
  }, [search, chats]);

  async function handleNewChat() {
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${projectId}/chats`, { label: 'New Chat' });
      navigateToChat(data.chat.id);
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  function handleSelectChat(chatId: string) {
    navigateToChat(chatId);
  }

  function navigateToChat(chatId: string) {
    onClose();
    navigate(`/project/${projectId}/chats/${chatId}`, { state: { prefillContent: formattedContent } });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Send to Chat</DialogTitle>
        </DialogHeader>

        <div className="mb-3">
          <Input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm py-1.5"
            placeholder="Search chats..."
          />
        </div>

        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          <button
            onClick={handleNewChat}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2 mb-1"
          >
            <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-sm font-medium text-primary">New Chat</span>
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-4 text-sm text-text-muted text-center">No chats found</div>
          ) : (
            results.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">{chat.label || 'Untitled Chat'}</div>
                  <div className="text-xs text-text-dim">{new Date(chat.createdAt).toLocaleDateString()}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
