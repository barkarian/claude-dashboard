import { query } from '@anthropic-ai/claude-agent-sdk';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const TITLE_AND_DESCRIPTION_PROMPT =
  'Based on the user\'s first message in a coding chat, generate:\n' +
  '1. A short descriptive title (max 60 chars)\n' +
  '2. A high-level description of the chat (2-4 sentences, max 100 words) summarizing the general context, technologies involved, what the user is trying to accomplish, and key concepts. This description will be used for search and as a quick summary.\n\n' +
  'Return EXACTLY this format (no extra text):\n' +
  'TITLE: <the title>\n' +
  'DESCRIPTION: <the description paragraph>';

export interface TitleAndDescription {
  title: string;
  description: string;
}

function extractTextFromStream(event: any): string {
  if (event.type === 'assistant') {
    const msg = (event as any).message;
    if (msg?.content) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          return block.text;
        }
      }
    }
  }
  return '';
}

function parseTitleAndDescription(raw: string): TitleAndDescription | null {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const descMatch = raw.match(/DESCRIPTION:\s*(.+)/is);

  const title = titleMatch?.[1]?.trim().replace(/^["']|["']$/g, '').slice(0, 80);
  const description = descMatch?.[1]?.trim().slice(0, 600);

  if (!title) return null;
  return { title, description: description || '' };
}

const SDK_STDERR = (data: string) => {
  if (data.includes('Error') || data.includes('error')) {
    console.error('[ai-title:stderr]', data.trim());
  }
};

const SDK_OPTIONS = {
  model: HAIKU_MODEL,
  tools: [] as string[],
  allowedTools: [] as string[],
  maxTurns: 1,
  persistSession: false,
  stderr: SDK_STDERR,
};

/**
 * Use Haiku 4.5 via the Agent SDK to generate a title + description
 * from the first user message. Returns null on any failure (graceful fallback).
 */
export async function generateChatTitleAndDescription(userMessage: string): Promise<TitleAndDescription | null> {
  try {
    const stream = query({
      prompt: userMessage.slice(0, 500),
      options: {
        ...SDK_OPTIONS,
        systemPrompt: TITLE_AND_DESCRIPTION_PROMPT,
      },
    });

    let rawText = '';
    for await (const event of stream) {
      const text = extractTextFromStream(event);
      if (text) rawText = text;
    }

    const result = parseTitleAndDescription(rawText);
    if (!result) {
      console.error('[ai-title] Could not parse title/description from:', rawText.slice(0, 200));
    }
    return result;
  } catch (err) {
    console.error('[ai-title] Generation failed:', err);
    return null;
  }
}
