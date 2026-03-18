import type { SDKChatMessage } from '../../../../shared/types/sdk.ts';
import ContentBlockRenderer from './blocks/ContentBlockRenderer.tsx';
import StreamingIndicator from './blocks/StreamingIndicator.tsx';

interface SDKMessageBubbleProps {
  message: SDKChatMessage;
}

export default function SDKMessageBubble({ message }: SDKMessageBubbleProps) {
  const isUser = message.role === 'user';

  // Extract plain text for user messages
  const userText = isUser
    ? message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 overflow-hidden break-words ${
          isUser
            ? 'bg-primary text-white rounded-br-md'
            : message.isError
              ? 'bg-danger/10 border border-danger/30 rounded-bl-md'
              : 'bg-bg-surface border border-border rounded-bl-md'
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{userText}</p>
        ) : (
          <div>
            {message.content.map((block, idx) => (
              <ContentBlockRenderer key={idx} block={block} />
            ))}
            {message.isPartial && <StreamingIndicator />}
          </div>
        )}

        {message.timestamp && !message.isPartial && (
          <div className={`text-[10px] mt-1 ${isUser ? 'text-white/60' : 'text-text-dim'}`}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}
