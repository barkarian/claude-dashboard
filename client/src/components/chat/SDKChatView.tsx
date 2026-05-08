import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSearch, type SearchHandler } from '../../context/SearchContext.tsx';
import { useSDKMessages } from '../../hooks/useSDKMessages.ts';
import { useDraft } from '../../hooks/useDraft.ts';
import MessageList from './MessageList.tsx';
import SDKPromptInput from './SDKPromptInput.tsx';
import ToolInstallBanner from './ToolInstallBanner.tsx';
import BrowserArtifact from './BrowserArtifact.tsx';
import PermissionPrompt from './PermissionPrompt.tsx';
import QuestionPrompt from './QuestionPrompt.tsx';
import CostBadge from './CostBadge.tsx';
import ModelPicker from './ModelPicker.tsx';
import ActivityBar from './ActivityBar.tsx';
import api from '../../utils/api.ts';
import type { SDKSessionStatus } from '../../../../shared/types/sdk.ts';
import type { ChatArtifact, ChatBrowserSession } from '../../../../shared/types/models.ts';

interface SDKChatViewProps {
  projectId: string;
}

export default function SDKChatView({ projectId }: SDKChatViewProps) {
  const { chatId } = useParams();
  const { socket } = useSocket();
  const location = useLocation();
  const navigate = useNavigate();
  const { project, setProject, refreshProject } = useProject();
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  const chat = project?.chats?.find(c => c.id === chatId);
  const { updateDraft, clearDraft } = useDraft(projectId, chatId, chat?.draftMessage || '', setProject);
  const { registerHandler, unregisterHandler } = useSearch();
  const messageListRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    status,
    activity,
    pendingPermission,
    pendingQuestion,
    lastResult,
    sendPrompt,
    respondToPermission,
    respondToQuestion,
    dismissQuestion,
    interrupt,
  } = useSDKMessages(socket, chatId);

  const [connecting, setConnecting] = useState(true);

  // Artifacts emitted by the agent's display_artifact tool (claw-chat adapter).
  // Loaded from the REST endpoint on mount, plus appended live via socket events.
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    api.get<{ artifacts: ChatArtifact[] }>(`/api/projects/${projectId}/chats/${chatId}/artifacts`)
      .then((data) => {
        if (!cancelled) setArtifacts(data.artifacts || []);
      })
      .catch(() => {
        // 404 / network — leave artifacts empty
      });
    return () => { cancelled = true; };
  }, [projectId, chatId]);

  useEffect(() => {
    if (!socket || !chatId) return;
    function handleArtifact({ chatId: cid, artifact }: { chatId: string; artifact: ChatArtifact }) {
      if (cid !== chatId) return;
      setArtifacts((prev) => prev.some(a => a.id === artifact.id) ? prev : [...prev, artifact]);
    }
    socket.on('chat:artifact', handleArtifact);
    return () => { socket.off('chat:artifact', handleArtifact); };
  }, [socket, chatId]);

  // Browser session cards (claw_browser MCP — display_browser_session).
  // Initial fetch + live append. Same pattern as artifacts.
  const [browserSessions, setBrowserSessions] = useState<ChatBrowserSession[]>([]);

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    api.get<{ sessions: ChatBrowserSession[] }>(`/api/projects/${projectId}/chats/${chatId}/browser-sessions`)
      .then((data) => {
        if (!cancelled) setBrowserSessions(data.sessions || []);
      })
      .catch(() => {
        // 404 / not yet wired — silently empty
      });
    return () => { cancelled = true; };
  }, [projectId, chatId]);

  useEffect(() => {
    if (!socket || !chatId) return;
    function handleBrowserSession({ chatId: cid, session }: { chatId: string; session: ChatBrowserSession }) {
      if (cid !== chatId) return;
      setBrowserSessions((prev) => prev.some(s => s.id === session.id) ? prev : [...prev, session]);
    }
    socket.on('chat:browser-session', handleBrowserSession);
    return () => { socket.off('chat:browser-session', handleBrowserSession); };
  }, [socket, chatId]);

  // Browser sessions used to be grouped by message id and rendered inline;
  // they now live in a persistent strip above the prompt. We just consume
  // the flat browserSessions array directly in the JSX below.

  const { artifactsByMessageId, trailingArtifacts } = useMemo(() => {
    const byMsg: Record<string, ChatArtifact[]> = {};
    const trailing: ChatArtifact[] = [];
    const messageIds = new Set(messages.map(m => m.id));
    for (const a of artifacts) {
      if (a.messageId && messageIds.has(a.messageId)) {
        (byMsg[a.messageId] ||= []).push(a);
      } else {
        trailing.push(a);
      }
    }
    return { artifactsByMessageId: byMsg, trailingArtifacts: trailing };
  }, [artifacts, messages]);

  // Determine autoFocus from navigation state (only set when explicitly creating a new chat)
  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;
  // autoSend: New Agent dialog stashes the typed prompt as the draft and
  // sets this flag. Once the SDK session is idle (ready to receive input),
  // fire the send exactly once and clear both the draft and the location
  // state so a refresh doesn't replay it.
  const autoSendRequested = !!(location.state as { autoSend?: boolean } | null)?.autoSend;
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!autoSendRequested || autoSentRef.current) return;
    if (status !== 'idle') return;
    const text = chat?.draftMessage?.trim();
    if (!text) return;
    autoSentRef.current = true;
    sendPrompt(text);
    clearDraft();
    // Clear the navigation state so back/forward / refresh doesn't replay.
    navigate(location.pathname, { replace: true, state: { isNewChat } });
  }, [autoSendRequested, status, chat?.draftMessage, sendPrompt, clearDraft, navigate, location.pathname, isNewChat]);

  // Start or attach to SDK session on mount
  useEffect(() => {
    if (!socket || !chatId) return;

    setConnecting(true);

    socket.emit('sdk:check-session', { chatId }, (result: { exists: boolean; status?: SDKSessionStatus }) => {
      setConnecting(false);
      if (result.exists) {
        // Session already running, attach to get current state
        socket.emit('sdk:attach', { chatId });
      } else {
        // Start new session
        socket.emit('sdk:start', { projectId, chatId });
      }
    });
  }, [socket, chatId, projectId]);

  // Listen for chat rename events
  useEffect(() => {
    if (!socket || !chatId) return;

    function handleChatRenamed({ chatId: cid }: { chatId: string }) {
      if (cid !== chatId) return;
      refreshRef.current();
    }

    socket.on('claude:chat-renamed', handleChatRenamed);
    return () => {
      socket.off('claude:chat-renamed', handleChatRenamed);
    };
  }, [socket, chatId]);

  // When the user arms/disarms a tool, the server ends the SDK session so the
  // next session re-inits with the new MCP set. Refresh the project context
  // (so chat.armedTools reflects the persisted state) and trigger a fresh
  // sdk:start so the agent picks up the change without a manual reload.
  useEffect(() => {
    if (!socket || !chatId) return;
    function handleArmedChanged(payload: { chatId: string; armedTools: string[] }) {
      console.log('[SDKChatView] chat:armed-tools-changed received', payload);
      if (payload.chatId !== chatId) return;
      refreshRef.current();
      socket?.emit('sdk:start', { projectId, chatId });
    }
    socket.on('chat:armed-tools-changed', handleArmedChanged);
    return () => { socket.off('chat:armed-tools-changed', handleArmedChanged); };
  }, [socket, chatId, projectId]);

  // Refresh project data when result arrives (history saved)
  useEffect(() => {
    if (lastResult) refreshRef.current();
  }, [lastResult]);

  // DOM-based search for SDK chat messages
  const marksRef = useRef<HTMLElement[]>([]);
  const currentIndexRef = useRef(-1);
  const lastQueryRef = useRef('');

  const clearMarks = useCallback(() => {
    marksRef.current.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
    marksRef.current = [];
    currentIndexRef.current = -1;
    lastQueryRef.current = '';
  }, []);

  const highlightMatches = useCallback((query: string) => {
    clearMarks();
    const container = messageListRef.current;
    if (!query || !container) return;

    const lowerQuery = query.toLowerCase();
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node.textContent || '').toLowerCase().includes(lowerQuery)) {
        textNodes.push(node as Text);
      }
    }

    const newMarks: HTMLElement[] = [];
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      const parent = textNode.parentNode;
      if (!parent) return;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerQuery, lastIndex)) !== -1) {
        if (idx > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
        }
        const mark = document.createElement('mark');
        mark.style.cssText = 'background: rgba(234, 179, 8, 0.3); border-radius: 2px; color: inherit;';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        newMarks.push(mark);
        lastIndex = idx + query.length;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      parent.replaceChild(frag, textNode);
    });

    marksRef.current = newMarks;
    lastQueryRef.current = query;
  }, [clearMarks]);

  const scrollToMark = useCallback((index: number) => {
    const marks = marksRef.current;
    if (index < 0 || index >= marks.length) return;
    marks.forEach(m => m.style.background = 'rgba(234, 179, 8, 0.3)');
    marks[index].style.background = 'rgba(234, 179, 8, 0.7)';
    marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const searchHandler = useMemo<SearchHandler>(() => ({
    findNext(query: string, incremental?: boolean) {
      if (query.toLowerCase() !== lastQueryRef.current.toLowerCase() || incremental || !marksRef.current.some(m => m.isConnected)) {
        highlightMatches(query);
      }
      if (marksRef.current.length === 0) return false;
      currentIndexRef.current = (currentIndexRef.current + 1) % marksRef.current.length;
      scrollToMark(currentIndexRef.current);
      return true;
    },
    findPrevious(query: string) {
      if (query.toLowerCase() !== lastQueryRef.current.toLowerCase() || !marksRef.current.some(m => m.isConnected)) {
        highlightMatches(query);
      }
      if (marksRef.current.length === 0) return false;
      currentIndexRef.current = currentIndexRef.current <= 0 ? marksRef.current.length - 1 : currentIndexRef.current - 1;
      scrollToMark(currentIndexRef.current);
      return true;
    },
    clearSearch: clearMarks,
  }), [highlightMatches, scrollToMark, clearMarks]);

  useEffect(() => {
    registerHandler(searchHandler);
    return () => {
      clearMarks();
      unregisterHandler(searchHandler);
    };
  }, [searchHandler, registerHandler, unregisterHandler, clearMarks]);

  function handleRestart() {
    if (!socket || !chatId) return;
    socket.emit('sdk:end', { chatId });
    setTimeout(() => {
      socket.emit('sdk:start', { projectId, chatId });
    }, 100);
  }

  // Model-switch handler: persist the new model, then end any active SDK
  // session so the next prompt starts fresh with it. The chat:stop event
  // is consumed by both claw-chat and opencode adapters.
  const handleModelChanged = useCallback((newModel: string) => {
    if (socket && chatId) socket.emit('chat:stop', { chatId });
    refreshRef.current?.();
    void newModel;
  }, [socket, chatId]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Slim model bar — visible only for message-based chats. Provider
          switching is locked once a chat is created; this picker only
          changes the model within the chat's adapter. */}
      {!connecting && chat && chatId && (
        <div className="flex-shrink-0 flex items-center justify-end px-3 py-1 border-b border-border bg-bg-surface">
          <ModelPicker
            projectId={projectId}
            chatId={chatId}
            adapterId={chat.adapter}
            currentModel={chat.model}
            onModelChanged={handleModelChanged}
          />
        </div>
      )}
      {/* Main content */}
      {connecting ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-text-muted text-sm">Connecting...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Messages (errors appear inline as chat bubbles) */}
          <MessageList
            ref={messageListRef}
            messages={messages}
            artifactsByMessageId={artifactsByMessageId}
            trailingArtifacts={trailingArtifacts}
            projectId={projectId}
          />

          {/* Persistent browser strip — shows the latest browser session this
              chat opened, with a live thumbnail and "agent driving" indicator.
              Click to expand into the full canvas dialog. Stays visible while
              browser is armed; doesn't pollute the message stream. */}
          {browserSessions.length > 0 && (
            <div className="flex-shrink-0 px-3 pt-2 space-y-2 border-t border-border bg-bg-surface">
              {browserSessions
                .filter(s => s.status !== 'closed')
                .slice(-3) // cap visible strip at 3 most recent active sessions
                .map(s => (
                  <BrowserArtifact key={s.id} session={s} />
                ))}
            </div>
          )}

          {/* Live "what is the agent doing" hint — replaces the old 3-dots
              streaming indicator with contextual labels (tool name, thinking,
              retry, awaiting permission). */}
          <ActivityBar label={activity} />

          {/* Cost badge */}
          {lastResult && status === 'idle' && <CostBadge result={lastResult} />}

          {/* Permission prompt */}
          {pendingPermission && (
            <PermissionPrompt
              permission={pendingPermission}
              onRespond={respondToPermission}
            />
          )}

          {/* Question prompt (AskUserQuestion) */}
          {pendingQuestion && (
            <QuestionPrompt
              question={pendingQuestion}
              onRespond={respondToQuestion}
              onDismiss={dismissQuestion}
            />
          )}

          {/* Session ended / error bar */}
          {(status === 'exited' || status === 'error') && (
            <div className="flex-shrink-0 px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {status === 'error' ? 'Session error' : 'Session ended'}
              </span>
              <button onClick={handleRestart} className="text-xs text-primary hover:text-primary-hover font-medium">
                Restart
              </button>
            </div>
          )}

          {/* Tool install progress (browser first-arm Chromium download) */}
          {chatId && <ToolInstallBanner chatId={chatId} />}

          {/* Input */}
          <SDKPromptInput
            key={chatId}
            projectId={projectId}
            chatId={chatId}
            armedTools={chat?.armedTools || []}
            status={status}
            onSend={sendPrompt}
            onInterrupt={interrupt}
            autoFocus={isNewChat}
            initialDraft={chat?.draftMessage || ''}
            onDraftChange={updateDraft}
            onClearDraft={clearDraft}
          />
        </>
      )}
    </div>
  );
}
