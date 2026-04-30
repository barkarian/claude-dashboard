import { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';
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

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  ({ messages, artifactsByMessageId, trailingArtifacts, projectId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, artifactsByMessageId, trailingArtifacts]);

    if (messages.length === 0 && !(trailingArtifacts && trailingArtifacts.length)) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-sm">Send a message to start the conversation</p>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">
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
    );
  },
);

MessageList.displayName = 'MessageList';

export default MessageList;
