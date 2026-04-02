import { query } from '@anthropic-ai/claude-agent-sdk';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const TITLE_AND_KEYWORDS_PROMPT =
  'Based on the user\'s first message in a coding chat, generate:\n' +
  '1. A short descriptive title (max 60 chars)\n' +
  '2. A paragraph of search keywords (up to 100 words) covering technologies, concepts, actions, file types, frameworks, and topics discussed\n\n' +
  'Return EXACTLY this format (two lines, no extra text):\n' +
  'TITLE: <the title>\n' +
  'KEYWORDS: <space-separated keywords and short phrases>';

export interface TitleAndKeywords {
  title: string;
  keywords: string;
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

function parseTitleAndKeywords(raw: string): TitleAndKeywords | null {
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/is);

  const title = titleMatch?.[1]?.trim().replace(/^["']|["']$/g, '').slice(0, 80);
  const keywords = keywordsMatch?.[1]?.trim().slice(0, 500);

  if (!title) return null;
  return { title, keywords: keywords || '' };
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
 * Use Haiku 4.5 via the Agent SDK to generate a title + search keywords
 * from the first user message. Returns null on any failure (graceful fallback).
 */
export async function generateChatTitleAndKeywords(userMessage: string): Promise<TitleAndKeywords | null> {
  try {
    const stream = query({
      prompt: userMessage.slice(0, 500),
      options: {
        ...SDK_OPTIONS,
        systemPrompt: TITLE_AND_KEYWORDS_PROMPT,
      },
    });

    let rawText = '';
    for await (const event of stream) {
      const text = extractTextFromStream(event);
      if (text) rawText = text;
    }

    const result = parseTitleAndKeywords(rawText);
    if (!result) {
      console.error('[ai-title] Could not parse title/keywords from:', rawText.slice(0, 200));
    }
    return result;
  } catch (err) {
    console.error('[ai-title] Generation failed:', err);
    return null;
  }
}

/**
 * Convenience wrapper that returns just the title string (for backward compat
 * with auto-naming socket handlers).
 */
export async function generateChatTitle(userMessage: string): Promise<string | null> {
  const result = await generateChatTitleAndKeywords(userMessage);
  return result?.title ?? null;
}
