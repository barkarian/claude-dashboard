import { query } from '@anthropic-ai/claude-agent-sdk';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const TITLE_SYSTEM_PROMPT =
  'Generate a short, descriptive title (max 60 chars) for a coding chat based on the user\'s first message. ' +
  'Return ONLY the title text, no quotes, no prefix, no explanation.';

/**
 * Use Haiku 4.5 via the Agent SDK to generate a short descriptive chat title
 * from the first user message. Returns null on any failure (graceful fallback).
 */
export async function generateChatTitle(userMessage: string): Promise<string | null> {
  try {
    const stream = query({
      prompt: userMessage.slice(0, 500),
      options: {
        model: HAIKU_MODEL,
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        persistSession: false,
        systemPrompt: TITLE_SYSTEM_PROMPT,
        stderr: (data: string) => {
          if (data.includes('Error') || data.includes('error')) {
            console.error('[ai-title:stderr]', data.trim());
          }
        },
      },
    });

    let title = '';
    for await (const event of stream) {
      if (event.type === 'assistant') {
        const msg = (event as any).message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              title = block.text;
            }
          }
        }
      }
    }

    const cleaned = title.trim().replace(/^["']|["']$/g, '');
    if (!cleaned) {
      console.error('[ai-title] Empty title returned from model');
    }
    return cleaned ? cleaned.slice(0, 80) : null;
  } catch (err) {
    console.error('[ai-title] Generation failed:', err);
    return null;
  }
}
