import type { ContentBlock } from '../../../../../shared/types/sdk.ts';
import MarkdownRenderer from './MarkdownRenderer.tsx';
import ToolUseCard from './ToolUseCard.tsx';
import ToolResultCard from './ToolResultCard.tsx';
import ThinkingBlock from './ThinkingBlock.tsx';

interface ContentBlockRendererProps {
  block: ContentBlock;
}

export default function ContentBlockRenderer({ block }: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return block.text ? <MarkdownRenderer text={block.text} /> : null;
    case 'tool_use':
      return <ToolUseCard block={block} />;
    case 'tool_result':
      return <ToolResultCard block={block} />;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    default:
      return null;
  }
}
