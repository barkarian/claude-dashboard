import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  SDKSessionStatus,
  SDKChatMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
} from '../../shared/types/sdk.ts';

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_CLEANUP_INTERVAL_MS = 60 * 1000;     // check every 60s

// Tools that Claude Code uses internally but can't be executed through the Agent SDK.
// When Claude tries these, we auto-deny with a message so it falls back to text.
const UNSUPPORTED_TOOLS = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'Skill',
  'NotebookEdit',
]);

// Tools we handle interactively (show UI to the user instead of auto-denying)
const INTERACTIVE_TOOLS = new Set([
  'AskUserQuestion',
]);

// Union of unsupported + interactive — used to filter these tool blocks from the chat stream
const FILTERED_TOOLS = new Set([...UNSUPPORTED_TOOLS, ...INTERACTIVE_TOOLS]);

interface PermissionResolver {
  resolve: (result: { behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QuestionResolver {
  resolve: (result: { behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SDKSession {
  chatId: string;
  projectId: string;
  projectPath: string;
  io: SocketIOServer;
  status: SDKSessionStatus;
  /** Session ID received from the SDK's init event — only set after a successful query */
  sdkSessionId?: string;
  abortController: AbortController | null;
  messages: SDKChatMessage[];
  permissionResolvers: Map<string, PermissionResolver>;
  questionResolvers: Map<string, QuestionResolver>;
  queryStartTime: number | null;
  lastActivityAt: number;
}

const sessions = new Map<string, SDKSession>();

function emitStatus(session: SDKSession, status: SDKSessionStatus): void {
  if (session.status === status) return;
  const prev = session.status;
  session.status = status;
  console.log(`[sdk:${session.chatId}] status: ${prev} -> ${status}`);

  const room = `claude:${session.chatId}`;
  session.io.to(room).emit('sdk:status', { chatId: session.chatId, status });
  session.io.to(`project:${session.projectId}`).emit('claude:session-status', {
    chatId: session.chatId,
    status: mapToLegacyStatus(status),
  });
}

function touchActivity(session: SDKSession): void {
  session.lastActivityAt = Date.now();
}

/** Map SDK status to legacy SessionStatus for useSessionStatuses compatibility */
function mapToLegacyStatus(status: SDKSessionStatus): string {
  switch (status) {
    case 'starting': return 'starting';
    case 'idle': return 'idle';
    case 'streaming': return 'thinking';
    case 'tool-use': return 'thinking';
    case 'waiting-permission': return 'waiting-input';
    case 'exited': return 'exited';
    case 'error': return 'exited';
    default: return 'idle';
  }
}

function initSession(
  chatId: string,
  projectId: string,
  projectPath: string,
  io: SocketIOServer,
  sdkSessionId?: string,
): void {
  // End existing session if any
  endSession(chatId);

  const session: SDKSession = {
    chatId,
    projectId,
    projectPath,
    io,
    status: 'starting',
    // Restore persisted SDK session ID for resume, or undefined for new conversations
    sdkSessionId: sdkSessionId || undefined,
    abortController: null,
    messages: [],
    permissionResolvers: new Map(),
    questionResolvers: new Map(),
    queryStartTime: null,
    lastActivityAt: Date.now(),
  };

  if (sdkSessionId) {
    console.log(`[sdk:${chatId}] Restored SDK session ID for resume: ${sdkSessionId}`);
  }

  sessions.set(chatId, session);
  emitStatus(session, 'idle');
}

/**
 * Convert old chat history (string content) to structured SDKChatMessage format.
 */
function migrateHistoryMessage(msg: any): SDKChatMessage {
  const content: ContentBlock[] =
    typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text', text: String(msg.content ?? '') }];

  return {
    id: msg.id || `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: msg.role,
    content,
    timestamp: msg.timestamp,
  };
}

async function sendPrompt(chatId: string, prompt: string): Promise<{ error?: string }> {
  const session = sessions.get(chatId);
  if (!session) return { error: 'Session not found' };
  if (session.status === 'exited' || session.status === 'error') {
    return { error: 'Session not active' };
  }

  touchActivity(session);

  // Add user message
  const userMessage: SDKChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: new Date().toISOString(),
  };
  session.messages.push(userMessage);

  const room = `claude:${chatId}`;
  session.io.to(room).emit('sdk:message', { chatId, message: userMessage });

  // Prepare abort controller
  session.abortController = new AbortController();
  session.queryStartTime = Date.now();
  emitStatus(session, 'streaming');

  // Build canUseTool permission bridge
  const canUseTool = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    _options: { signal: AbortSignal },
  ) => {
    // Handle AskUserQuestion interactively — show UI to the user
    if (toolName === 'AskUserQuestion' && INTERACTIVE_TOOLS.has(toolName)) {
      const questions = (toolInput as any).questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        return {
          behavior: 'deny' as const,
          message: 'AskUserQuestion requires a non-empty questions array.',
        };
      }

      emitStatus(session, 'waiting-permission');

      const requestId = `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      session.io.to(room).emit('sdk:question-request', {
        chatId,
        requestId,
        questions,
      });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          session.questionResolvers.delete(requestId);
          resolve({ behavior: 'deny', message: 'Question timed out — user did not respond.' });
        }, PERMISSION_TIMEOUT_MS);

        session.questionResolvers.set(requestId, { resolve, timer });
      });
    }

    // Auto-deny tools that can't be executed in this environment
    if (UNSUPPORTED_TOOLS.has(toolName)) {
      console.log(`[sdk:${chatId}] Auto-denied unsupported tool: ${toolName}`);
      return {
        behavior: 'deny' as const,
        message: `${toolName} is not available. Please communicate directly with the user in your response text instead.`,
      };
    }

    emitStatus(session, 'waiting-permission');

    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build a human-readable description
    let description = `Claude wants to use: ${toolName}`;
    if (toolName === 'Bash' && toolInput.command) {
      description = `Run command: ${toolInput.command}`;
    } else if (toolName === 'Write' && toolInput.file_path) {
      description = `Write file: ${toolInput.file_path}`;
    } else if (toolName === 'Edit' && toolInput.file_path) {
      description = `Edit file: ${toolInput.file_path}`;
    }

    session.io.to(room).emit('sdk:permission-request', {
      chatId,
      requestId,
      toolName,
      toolInput,
      description,
    });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.permissionResolvers.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission timed out' });
      }, PERMISSION_TIMEOUT_MS);

      session.permissionResolvers.set(requestId, { resolve, timer });
    });
  };

  // Create a partial assistant message for streaming
  const assistantMsgId = `assistant-${Date.now()}`;
  let currentContent: ContentBlock[] = [];

  const partialMessage: SDKChatMessage = {
    id: assistantMsgId,
    role: 'assistant',
    content: [],
    isPartial: true,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(partialMessage);
  session.io.to(room).emit('sdk:message', { chatId, message: partialMessage });

  // Try with resume first, fall back to fresh conversation if resume fails
  let useResume = !!session.sdkSessionId;

  for (let attempt = 0; attempt < 2; attempt++) {
    const queryOptions: any = {
      cwd: session.projectPath,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      abortController: session.abortController,
      includePartialMessages: true,
      canUseTool,
      // Load project-level settings (CLAUDE.md, .claude/settings.json) from the project directory
      settingSources: ['project'],
      // Tell Claude explicitly where the project root is so it doesn't write outside it
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: `\n\nIMPORTANT: Your project root directory is ${session.projectPath}. All files you create, read, or modify MUST be within this directory. When the user refers to "root directory", "project root", or "here", they mean ${session.projectPath}. Never create files outside this directory.`,
      },
      stderr: (data: string) => {
        console.error(`[sdk:${chatId}:stderr] ${data}`);
        // Emit significant errors to the client so they appear in chat
        if (data.includes('Error') || data.includes('error') || data.includes('ZodError')) {
          session.io.to(room).emit('sdk:error', { chatId, error: data.trim() });
        }
      },
    };

    if (useResume && session.sdkSessionId) {
      queryOptions.resume = session.sdkSessionId;
      console.log(`[sdk:${chatId}] Resuming with session ID: ${session.sdkSessionId}`);
    }

    try {
      currentContent = [];
      const stream = query({ prompt, options: queryOptions });
      let resultData: any = null;

      // Track unsupported tool blocks so we can filter them and their results
      let skippingBlock = false;
      const skippedToolIds = new Set<string>();

      for await (const event of stream) {
        if (session.abortController?.signal.aborted) break;

        // SDKSystemMessage — init event with session_id
        if (event.type === 'system' && (event as any).subtype === 'init') {
          if ((event as any).session_id) {
            session.sdkSessionId = (event as any).session_id;
          }
          continue;
        }

        // SDKPartialAssistantMessage (stream_event) — streaming content updates
        if (event.type === 'stream_event') {
          const rawEvent = (event as any).event;
          if (!rawEvent) continue;

          // Handle different stream event types from Anthropic SDK
          if (rawEvent.type === 'content_block_start') {
            const block = rawEvent.content_block;

            // Skip unsupported/interactive tool blocks entirely
            if (block?.type === 'tool_use' && FILTERED_TOOLS.has(block.name)) {
              skippingBlock = true;
              skippedToolIds.add(block.id || '');
              continue;
            }

            skippingBlock = false;
            if (block?.type === 'text') {
              currentContent.push({ type: 'text', text: '' } as TextBlock);
            } else if (block?.type === 'tool_use') {
              currentContent.push({
                type: 'tool_use',
                id: block.id || '',
                name: block.name || '',
                input: {},
              } as ToolUseBlock);
              emitStatus(session, 'tool-use');
            } else if (block?.type === 'thinking') {
              currentContent.push({ type: 'thinking', thinking: '' } as ThinkingBlock);
            }
          } else if (rawEvent.type === 'content_block_delta') {
            if (skippingBlock) continue; // Skip deltas for unsupported tools

            const delta = rawEvent.delta;
            const lastBlock = currentContent[currentContent.length - 1];
            if (delta?.type === 'text_delta' && lastBlock?.type === 'text') {
              (lastBlock as TextBlock).text += delta.text || '';
            } else if (delta?.type === 'thinking_delta' && lastBlock?.type === 'thinking') {
              (lastBlock as ThinkingBlock).thinking += delta.thinking || '';
            } else if (delta?.type === 'input_json_delta' && lastBlock?.type === 'tool_use') {
              // Tool input is streamed as JSON fragments — accumulate for parsing later
              if (!(lastBlock as any)._rawInput) (lastBlock as any)._rawInput = '';
              (lastBlock as any)._rawInput += delta.partial_json || '';
            }
          } else if (rawEvent.type === 'content_block_stop') {
            if (skippingBlock) {
              skippingBlock = false;
              continue; // Skip stop for unsupported tools
            }

            // Try to parse accumulated tool input JSON
            const lastBlock = currentContent[currentContent.length - 1];
            if (lastBlock?.type === 'tool_use' && (lastBlock as any)._rawInput) {
              try {
                (lastBlock as ToolUseBlock).input = JSON.parse((lastBlock as any)._rawInput);
              } catch {
                // Partial JSON — leave as empty
              }
              delete (lastBlock as any)._rawInput;
            }
          }

          if (skippingBlock) continue; // Don't emit updates while skipping

          // Emit partial update
          partialMessage.content = [...currentContent];
          session.io.to(room).emit('sdk:partial-update', {
            chatId,
            messageId: assistantMsgId,
            content: partialMessage.content,
          });

          if (session.status !== 'waiting-permission' && session.status !== 'tool-use') {
            emitStatus(session, 'streaming');
          }
          continue;
        }

        // SDKAssistantMessage — final assistant message for current turn.
        // Don't replace accumulated content — streaming already built it up
        // across turns (tool use → tool result → text). Replacing would discard
        // previous turns' content, causing them to flash and disappear.
        if (event.type === 'assistant') {
          partialMessage.content = [...currentContent];
          partialMessage.isPartial = false;

          session.io.to(room).emit('sdk:message', {
            chatId,
            message: partialMessage,
          });
          continue;
        }

        // SDKUserMessage — tool results (user role messages with tool_result content)
        if (event.type === 'user') {
          const msg = (event as any).message;
          if (msg?.content && Array.isArray(msg.content)) {
            // Append tool results to the current message content
            for (const block of msg.content) {
              if (block.type === 'tool_result') {
                // Skip results for unsupported tools (e.g. AskUserQuestion denial)
                if (skippedToolIds.has(block.tool_use_id || '')) continue;

                const content = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c.text || '').join('\n')
                    : '';
                currentContent.push({
                  type: 'tool_result',
                  tool_use_id: block.tool_use_id || '',
                  content,
                  is_error: block.is_error || false,
                } as ToolResultBlock);
              }
            }

            partialMessage.content = [...currentContent];
            partialMessage.isPartial = true;

            session.io.to(room).emit('sdk:partial-update', {
              chatId,
              messageId: assistantMsgId,
              content: partialMessage.content,
            });
          }
          continue;
        }

        // SDKResultMessage — final result with cost/usage data
        if (event.type === 'result') {
          resultData = event;
          if ((event as any).session_id) {
            session.sdkSessionId = (event as any).session_id;
          }
          continue;
        }
      }

      // Finalize the message
      partialMessage.isPartial = false;
      if (partialMessage.content.length === 0) {
        partialMessage.content = [{ type: 'text', text: '(No response)' }];
      }

      session.io.to(room).emit('sdk:message', {
        chatId,
        message: partialMessage,
      });

      // Emit result
      const durationMs = resultData?.duration_ms ?? (session.queryStartTime ? Date.now() - session.queryStartTime : 0);
      session.io.to(room).emit('sdk:result', {
        chatId,
        costUSD: resultData?.total_cost_usd ?? 0,
        inputTokens: resultData?.usage?.input_tokens ?? 0,
        outputTokens: resultData?.usage?.output_tokens ?? 0,
        durationMs,
        sessionId: session.sdkSessionId,
      });

      touchActivity(session);
      emitStatus(session, 'idle');
      break; // Success — exit retry loop
    } catch (err: any) {
      if (err.name === 'AbortError' || session.abortController?.signal.aborted) {
        console.log(`[sdk:${chatId}] Query aborted`);
        touchActivity(session);
        emitStatus(session, 'idle');
        break;
      } else if (useResume && attempt === 0) {
        // Resume failed — likely invalid/expired session ID. Retry without resume.
        console.warn(`[sdk:${chatId}] Resume failed (${err.message}), retrying without resume`);
        session.sdkSessionId = undefined;
        useResume = false;
        // Reset abort controller for retry
        session.abortController = new AbortController();
        continue; // Retry without resume
      } else {
        const errMsg = err.message || String(err);
        console.error(`[sdk:${chatId}] Query error:`, errMsg);
        console.error(`[sdk:${chatId}] Full error:`, err.stack || err);
        session.io.to(room).emit('sdk:error', { chatId, error: errMsg });
        emitStatus(session, 'error');
        break;
      }
    }
  }

  // Clean up after all attempts
  session.abortController = null;
  session.queryStartTime = null;

  return {};
}

/**
 * Convert SDK message content to our ContentBlock format.
 */
function convertSDKContent(sdkContent: any[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const block of sdkContent) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text || '' } as TextBlock);
    } else if (block.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: block.id || '',
        name: block.name || '',
        input: block.input || {},
      } as ToolUseBlock);
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c: any) => c.text || '').join('\n')
          : '';
      blocks.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id || '',
        content,
        is_error: block.is_error || false,
      } as ToolResultBlock);
    } else if (block.type === 'thinking') {
      blocks.push({ type: 'thinking', thinking: block.thinking || '' } as ThinkingBlock);
    }
  }

  return blocks;
}

function resolveQuestion(chatId: string, requestId: string, answers: Record<number, string[]>): void {
  const session = sessions.get(chatId);
  if (!session) return;

  const resolver = session.questionResolvers.get(requestId);
  if (!resolver) return;

  clearTimeout(resolver.timer);

  // Empty answers means the user chose "Chat about these questions instead"
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    resolver.resolve({
      behavior: 'deny',
      message: 'The user would prefer to discuss these questions conversationally in the chat rather than selecting from predefined options. Please ask them directly in your response text.',
    });
    session.questionResolvers.delete(requestId);
    return;
  }

  // Format answers as human-readable text for Claude to consume
  const lines: string[] = [];
  for (const [idx, selected] of entries) {
    lines.push(`Question ${Number(idx) + 1}: ${selected.join(', ')}`);
  }
  const formatted = lines.join('\n');

  resolver.resolve({ behavior: 'deny', message: `User answered:\n${formatted}` });
  session.questionResolvers.delete(requestId);
  touchActivity(session);
}

function resolvePermission(chatId: string, requestId: string, granted: boolean): void {
  const session = sessions.get(chatId);
  if (!session) return;

  const resolver = session.permissionResolvers.get(requestId);
  if (!resolver) return;

  clearTimeout(resolver.timer);
  if (granted) {
    resolver.resolve({ behavior: 'allow' });
  } else {
    resolver.resolve({ behavior: 'deny', message: 'User denied permission' });
  }
  session.permissionResolvers.delete(requestId);
  touchActivity(session);

  if (granted) {
    emitStatus(session, 'tool-use');
  }
}

function interrupt(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session) return;

  if (session.abortController) {
    session.abortController.abort();
    // Don't null here — sendPrompt()'s catch block needs to check
    // signal.aborted to distinguish abort from real errors
  }

  // Clean up pending permission requests
  for (const [, resolver] of session.permissionResolvers) {
    clearTimeout(resolver.timer);
    resolver.resolve({ behavior: 'deny', message: 'Interrupted' });
  }
  session.permissionResolvers.clear();

  // Clean up pending question requests
  for (const [, resolver] of session.questionResolvers) {
    clearTimeout(resolver.timer);
    resolver.resolve({ behavior: 'deny', message: 'Interrupted' });
  }
  session.questionResolvers.clear();
}

function endSession(chatId: string): void {
  const session = sessions.get(chatId);
  if (!session) return;

  interrupt(chatId);
  emitStatus(session, 'exited');
  sessions.delete(chatId);
}

function getSession(chatId: string): SDKSession | null {
  return sessions.get(chatId) || null;
}

function getMessageHistory(chatId: string): SDKChatMessage[] {
  const session = sessions.get(chatId);
  return session ? session.messages : [];
}

function getProjectSessions(projectId: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [chatId, session] of sessions) {
    if (session.projectId === projectId) {
      result[chatId] = mapToLegacyStatus(session.status);
    }
  }
  return result;
}

function endAllSessions(): void {
  for (const chatId of [...sessions.keys()]) {
    endSession(chatId);
  }
}

function cleanupIdleSessions(): void {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (session.status !== 'idle' && session.status !== 'error') continue;
    if (now - session.lastActivityAt >= IDLE_SESSION_TIMEOUT_MS) {
      console.log(`[sdk:${chatId}] Auto-ending idle session`);
      endSession(chatId);
    }
  }
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startIdleCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanupIdleSessions, IDLE_CLEANUP_INTERVAL_MS);
  cleanupInterval.unref();
}

function stopIdleCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export { migrateHistoryMessage };

export default {
  initSession,
  sendPrompt,
  resolvePermission,
  resolveQuestion,
  interrupt,
  endSession,
  getSession,
  getMessageHistory,
  getProjectSessions,
  endAllSessions,
  migrateHistoryMessage,
  startIdleCleanup,
  stopIdleCleanup,
};
