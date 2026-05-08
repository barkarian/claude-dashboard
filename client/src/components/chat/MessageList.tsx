import { forwardRef, useCallback, useEffect, useRef, useImperativeHandle, useState } from 'react';
import type { SDKChatMessage } from '../../../../shared/types/sdk.ts';
import type { ChatArtifact } from '../../../../shared/types/models.ts';
import SDKMessageBubble from './SDKMessageBubble.tsx';
import ArtifactCard from './ArtifactCard.tsx';

interface MessageListProps {
  messages: SDKChatMessage[];
  /** Artifacts grouped by the assistant message ID that produced them. */
  artifactsByMessageId?: Record<string, ChatArtifact[]>;
  /** Artifacts that don't anchor to any message (e.g. their message was lost). Rendered at the end. */
  trailingArtifacts?: ChatArtifact[];
  /** Project ID — used by ArtifactCard to build /files/download URLs. */
  projectId?: string;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 80;

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  ({ messages, artifactsByMessageId, trailingArtifacts, projectId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    // Track whether the user is pinned to the bottom. While true, new content
    // auto-scrolls. While false (user scrolled up to read older messages),
    // we leave them where they are and surface a "scroll to bottom" button.
    const [atBottom, setAtBottom] = useState(true);

    useImperativeHandle(ref, () => containerRef.current!);

    const isAtBottom = useCallback(() => {
      const el = containerRef.current;
      if (!el) return true;
      return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
    }, []);

    function handleScroll() {
      setAtBottom(isAtBottom());
    }

    function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
      bottomRef.current?.scrollIntoView({ behavior });
    }

    // Auto-scroll only when the user is already pinned to the bottom.
    useEffect(() => {
      if (atBottom) scrollToBottom('smooth');
    }, [messages, artifactsByMessageId, trailingArtifacts, atBottom]);

    if (messages.length === 0 && !(trailingArtifacts && trailingArtifacts.length)) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm">Send a message to start the conversation</p>
        </div>
      );
    }

    return (
      <div className="flex-1 relative flex flex-col overflow-hidden">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4"
        >
          {messages.map((message) => {
            const artifacts = artifactsByMessageId?.[message.id] || [];
            return (
              <div key={message.id}>
                <SDKMessageBubble message={message} />
                {projectId && artifacts.length > 0 && (
                  <div className="mt-1 ml-2 space-y-1">
                    {artifacts.map((a) => (
                      <ArtifactCard key={a.id} artifact={a} projectId={projectId} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {projectId && trailingArtifacts && trailingArtifacts.length > 0 && (
            <div className="ml-2 space-y-1">
              {trailingArtifacts.map((a) => (
                <ArtifactCard key={a.id} artifact={a} projectId={projectId} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-3 right-4 z-10 rounded-full bg-bg-surface border border-border shadow-md w-10 h-10 flex items-center justify-center hover:bg-bg-hover"
            aria-label="Scroll to latest"
            title="Scroll to latest"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);

MessageList.displayName = 'MessageList';

export default MessageList;
