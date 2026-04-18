import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Server as SocketIOServer } from 'socket.io';

interface AIGenSession {
  id: string;
  abortController: AbortController;
  io: SocketIOServer;
  socketId: string;
}

const sessions = new Map<string, AIGenSession>();

// ─── Prompt Templates ────────────────────────────────────────────

const COMMAND_SYSTEM_PROMPT = `You are a terminal command expert helping a developer generate shell commands.

MANDATORY STEPS (always do these BEFORE generating the command):
1. Use Glob to list files in the project root to understand the project structure
2. Read package.json (if it exists) to discover available npm/pnpm/yarn scripts and dependencies
3. Check for Makefile, docker-compose.yml, Cargo.toml, pyproject.toml, go.mod, or other build files

RULES:
- After analyzing the project, respond with ONLY the exact command to run — nothing else
- No explanation, no markdown, no backticks, no newlines
- Just the raw, executable command
- Use the correct package manager (npm, pnpm, yarn) based on lock files (pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm)
- If the user asks to run something by name (e.g. "run dev server", "run hello-world"), check package.json scripts first and use the matching script (e.g. "pnpm run hello-world") rather than guessing a raw command
- If the user's description is ambiguous, pick the most common/sensible interpretation based on the actual project contents`;

const AUTO_DETECT_SYSTEM_PROMPT = `You are a project analysis expert. Analyze the project to suggest the most important scripts a developer would need.

STEPS:
1. Read package.json (if exists) for npm scripts
2. Check for Makefile, docker-compose.yml, Dockerfile, etc.
3. Look at the project structure for common patterns

RULES:
- Suggest 3-8 of the most useful scripts
- Each script needs: label (human-friendly name), command (shell command)
- Respond with ONLY a JSON array, no other text
- Format: [{"label": "Dev Server", "command": "npm run dev"}]
- Do NOT wrap in markdown code blocks`;

const DESCRIBE_SCRIPTS_SYSTEM_PROMPT = `You are a DevOps expert helping create project scripts based on the user's description.

STEPS:
1. First analyze the project structure to understand the tech stack
2. Then generate scripts matching the user's request

RULES:
- Generate appropriate scripts for the request
- Each script needs: label (human-friendly name), command (shell command)
- Respond with ONLY a JSON array, no other text
- Format: [{"label": "...", "command": "..."}]
- Do NOT wrap in markdown code blocks`;

const COMMIT_MESSAGE_SYSTEM_PROMPT = `You are a git commit message expert. Analyze the current changes in the repository and write a concise, meaningful commit message.

MANDATORY STEPS:
1. Run \`git diff\` via the Bash tool to see unstaged changes
2. Run \`git diff --cached\` via the Bash tool to see staged changes
3. Run \`git status\` via the Bash tool to see the overall state

RULES:
- Write a conventional commit message (e.g. "feat: add user auth", "fix: resolve null pointer in parser")
- First line should be under 72 characters
- If the changes are significant, add a blank line then a brief body
- Respond with ONLY the commit message — no explanation, no markdown, no backticks
- If there are no changes, respond with "No changes to commit"`;

// ─── Generation Functions ────────────────────────────────────────

async function generateCommand(
  sessionId: string,
  projectPath: string,
  description: string,
  socketId: string,
  io: SocketIOServer,
): Promise<void> {
  const abortController = new AbortController();
  const session: AIGenSession = { id: sessionId, abortController, io, socketId };
  sessions.set(sessionId, session);

  const room = `ai:${sessionId}`;

  try {
    io.to(room).emit('ai:status', { sessionId, status: 'analyzing', step: 'Understanding your request...' });

    const stream = query({
      prompt: `Generate a terminal command for: ${description}`,
      options: {
        cwd: projectPath,
        allowedTools: ['Read', 'Glob', 'Grep'],
        abortController,
        includePartialMessages: true,
        canUseTool: async (toolName, toolInput) => {
          if (toolName === 'Read') {
            const filePath = String((toolInput as any).file_path || '');
            const fileName = filePath.split('/').pop() || filePath;
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: `Reading ${fileName}...` });
          } else if (toolName === 'Glob') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Scanning project...' });
          } else if (toolName === 'Grep') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Searching...' });
          }
          return { behavior: 'allow' as const, updatedInput: {} };
        },
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `\n\n${COMMAND_SYSTEM_PROMPT}\n\nProject root: ${projectPath}`,
        },
        stderr: () => {},
      },
    });

    let fullText = '';
    let hasEmittedToolUse = false;

    for await (const event of stream) {
      if (abortController.signal.aborted) break;

      if (event.type === 'stream_event') {
        const rawEvent = (event as any).event;
        if (!rawEvent) continue;

        if (rawEvent.type === 'content_block_start') {
          const block = rawEvent.content_block;
          if (block?.type === 'tool_use' && !hasEmittedToolUse) {
            hasEmittedToolUse = true;
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: `Reading ${block.name === 'Read' ? 'file' : 'project'}...` });
          }
        }

        if (rawEvent.type === 'content_block_delta') {
          const delta = rawEvent.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            fullText += delta.text;
            io.to(room).emit('ai:partial', { sessionId, text: fullText });
          }
        }
      }

      if (event.type === 'assistant') {
        // Extract text from final message
        const msg = (event as any).message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              fullText = block.text;
            }
          }
        }
      }
    }

    // Clean the result — remove any markdown formatting
    let command = fullText.trim();
    command = command.replace(/^```[a-z]*\n?/g, '').replace(/\n?```$/g, '').trim();
    // If multi-line, take only the first non-empty line that looks like a command
    if (command.includes('\n')) {
      const lines = command.split('\n').filter(l => l.trim());
      command = lines[0] || command;
    }

    io.to(room).emit('ai:result', { sessionId, type: 'command', result: command });
  } catch (err: any) {
    if (err.name !== 'AbortError' && !abortController.signal.aborted) {
      io.to(room).emit('ai:error', { sessionId, error: err.message || 'Generation failed' });
    }
  } finally {
    sessions.delete(sessionId);
  }
}

async function generateScripts(
  sessionId: string,
  projectPath: string,
  mode: 'auto-detect' | 'describe',
  description: string | undefined,
  socketId: string,
  io: SocketIOServer,
): Promise<void> {
  const abortController = new AbortController();
  const session: AIGenSession = { id: sessionId, abortController, io, socketId };
  sessions.set(sessionId, session);

  const room = `ai:${sessionId}`;

  const systemPrompt = mode === 'auto-detect' ? AUTO_DETECT_SYSTEM_PROMPT : DESCRIBE_SCRIPTS_SYSTEM_PROMPT;
  const userPrompt = mode === 'auto-detect'
    ? 'Analyze this project and suggest the most important scripts I should set up.'
    : `Generate scripts for: ${description}`;

  try {
    io.to(room).emit('ai:status', { sessionId, status: 'analyzing', step: 'Scanning project structure...' });

    const stream = query({
      prompt: userPrompt,
      options: {
        cwd: projectPath,
        allowedTools: ['Read', 'Glob', 'Grep'],
        abortController,
        includePartialMessages: true,
        canUseTool: async (toolName, toolInput) => {
          // Emit what the AI is doing
          if (toolName === 'Read') {
            const filePath = String((toolInput as any).file_path || '');
            const fileName = filePath.split('/').pop() || filePath;
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: `Reading ${fileName}...` });
          } else if (toolName === 'Glob') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Scanning files...' });
          } else if (toolName === 'Grep') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Searching codebase...' });
          }
          return { behavior: 'allow' as const, updatedInput: {} };
        },
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `\n\n${systemPrompt}\n\nProject root: ${projectPath}`,
        },
        stderr: () => {},
      },
    });

    let fullText = '';

    for await (const event of stream) {
      if (abortController.signal.aborted) break;

      if (event.type === 'stream_event') {
        const rawEvent = (event as any).event;
        if (!rawEvent) continue;

        if (rawEvent.type === 'content_block_start') {
          const block = rawEvent.content_block;
          if (block?.type === 'text') {
            io.to(room).emit('ai:status', { sessionId, status: 'generating', step: 'Generating scripts...' });
          }
        }

        if (rawEvent.type === 'content_block_delta') {
          const delta = rawEvent.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            fullText += delta.text;
            io.to(room).emit('ai:partial', { sessionId, text: fullText });
          }
        }
      }

      if (event.type === 'assistant') {
        const msg = (event as any).message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              fullText = block.text;
            }
          }
        }
      }
    }

    // Parse the JSON result
    let scripts: any[] = [];
    try {
      // Clean markdown formatting if present
      let cleaned = fullText.trim();
      cleaned = cleaned.replace(/^```[a-z]*\n?/g, '').replace(/\n?```$/g, '').trim();
      // Find JSON array in the response
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        scripts = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If parsing fails, emit raw text as error
      io.to(room).emit('ai:error', { sessionId, error: 'Failed to parse AI response. Please try again.' });
      return;
    }

    io.to(room).emit('ai:result', { sessionId, type: 'scripts', result: scripts });
  } catch (err: any) {
    if (err.name !== 'AbortError' && !abortController.signal.aborted) {
      io.to(room).emit('ai:error', { sessionId, error: err.message || 'Generation failed' });
    }
  } finally {
    sessions.delete(sessionId);
  }
}

async function generateCommitMessage(
  sessionId: string,
  projectPath: string,
  socketId: string,
  io: SocketIOServer,
): Promise<void> {
  const abortController = new AbortController();
  const session: AIGenSession = { id: sessionId, abortController, io, socketId };
  sessions.set(sessionId, session);

  const room = `ai:${sessionId}`;

  try {
    io.to(room).emit('ai:status', { sessionId, status: 'analyzing', step: 'Analyzing changes...' });

    const stream = query({
      prompt: 'Analyze the current git changes and generate a commit message.',
      options: {
        cwd: projectPath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
        abortController,
        includePartialMessages: true,
        canUseTool: async (toolName, toolInput) => {
          if (toolName === 'Bash') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Running git commands...' });
          } else if (toolName === 'Read') {
            const filePath = String((toolInput as any).file_path || '');
            const fileName = filePath.split('/').pop() || filePath;
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: `Reading ${fileName}...` });
          } else if (toolName === 'Glob') {
            io.to(room).emit('ai:status', { sessionId, status: 'reading', step: 'Scanning project...' });
          }
          return { behavior: 'allow' as const, updatedInput: {} };
        },
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `\n\n${COMMIT_MESSAGE_SYSTEM_PROMPT}\n\nProject root: ${projectPath}`,
        },
        stderr: () => {},
      },
    });

    let fullText = '';

    for await (const event of stream) {
      if (abortController.signal.aborted) break;

      if (event.type === 'stream_event') {
        const rawEvent = (event as any).event;
        if (!rawEvent) continue;

        if (rawEvent.type === 'content_block_delta') {
          const delta = rawEvent.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            fullText += delta.text;
            io.to(room).emit('ai:partial', { sessionId, text: fullText });
          }
        }
      }

      if (event.type === 'assistant') {
        const msg = (event as any).message;
        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              fullText = block.text;
            }
          }
        }
      }
    }

    // Clean the result
    let message = fullText.trim();
    message = message.replace(/^```[a-z]*\n?/g, '').replace(/\n?```$/g, '').trim();

    io.to(room).emit('ai:result', { sessionId, type: 'commit-message', result: message });
  } catch (err: any) {
    if (err.name !== 'AbortError' && !abortController.signal.aborted) {
      io.to(room).emit('ai:error', { sessionId, error: err.message || 'Generation failed' });
    }
  } finally {
    sessions.delete(sessionId);
  }
}

function cancel(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.abortController.abort();
  sessions.delete(sessionId);
}

function cancelAll(): void {
  for (const [id] of sessions) {
    cancel(id);
  }
}

export default { generateCommand, generateScripts, generateCommitMessage, cancel, cancelAll };
