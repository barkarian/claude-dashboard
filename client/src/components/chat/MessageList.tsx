import { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';
import type { SDKChatMessage } from '../../../../shared/types/sdk.ts';
import SDKMessageBubble from './SDKMessageBubble.tsx';

interface MessageListProps {
  messages: SDKChatMessage[];
}

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(({ messages }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => containerRef.current!);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-text-muted text-sm">Send a message to start the conversation</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4 scrollbar-left">
      {messages.map((message) => (
        <SDKMessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
});

MessageList.displayName = 'MessageList';

export default MessageList;
