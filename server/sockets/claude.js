import claudeManager from '../services/claudeManager.js';
import projectManager from '../services/projectManager.js';

export default function registerClaudeEvents(socket, io) {
  socket.on('claude:start', async ({ projectId, chatId }) => {
    try {
      const projectPath = projectManager.getProjectPath(projectId);
      const room = `claude:${chatId}`;
      socket.join(room);

      claudeManager.startSession(chatId, projectId, projectPath, io);
      socket.emit('claude:status', { chatId, status: 'starting' });
    } catch (err) {
      console.error('claude:start error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:send', async ({ chatId, prompt, promptId }) => {
    try {
      const result = claudeManager.sendPrompt(chatId, prompt, promptId);
      if (result.error) {
        socket.emit('claude:error', { chatId, error: result.error });
        return;
      }

      // Save to chat history
      const session = claudeManager.getSession(chatId);
      if (session) {
        const project = await projectManager.getProject(session.projectId);
        if (project) {
          const chat = (project.chats || []).find(c => c.id === chatId);
          if (chat) {
            chat.history.push({
              role: 'user',
              content: prompt,
              timestamp: new Date().toISOString(),
            });
            await projectManager.updateProject(session.projectId, { chats: project.chats });
          }
        }
      }
    } catch (err) {
      console.error('claude:send error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:cancel', ({ chatId }) => {
    claudeManager.cancelPrompt(chatId);
  });

  socket.on('claude:confirm', ({ chatId, answer }) => {
    claudeManager.confirmAction(chatId, answer);
  });

  const ALLOWED_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab', 'ShiftTab'];

  socket.on('claude:key-sequence', ({ chatId, key }) => {
    try {
      if (!ALLOWED_KEYS.includes(key)) {
        socket.emit('claude:error', { chatId, error: `Invalid key: ${key}` });
        return;
      }
      const result = claudeManager.sendKeySequence(chatId, key);
      if (result?.error) {
        socket.emit('claude:error', { chatId, error: result.error });
      }
    } catch (err) {
      console.error('claude:key-sequence error:', err);
      socket.emit('claude:error', { chatId, error: err.message });
    }
  });

  socket.on('claude:end', ({ chatId }) => {
    claudeManager.endSession(chatId);
  });

  socket.on('claude:attach', ({ chatId }) => {
    const room = `claude:${chatId}`;
    socket.join(room);

    const buffer = claudeManager.getBuffer(chatId);
    if (buffer) {
      socket.emit('claude:output', { chatId, data: buffer, promptId: null });
    }

    const session = claudeManager.getSession(chatId);
    if (session) {
      socket.emit('claude:status', { chatId, status: session.status });
    }
  });

  // Save assistant responses to chat history
  socket.on('claude:response-complete', async ({ chatId, response }) => {
    try {
      const session = claudeManager.getSession(chatId);
      if (!session) return;

      const project = await projectManager.getProject(session.projectId);
      if (!project) return;

      const chat = (project.chats || []).find(c => c.id === chatId);
      if (chat) {
        chat.history.push({
          role: 'assistant',
          content: response,
          timestamp: new Date().toISOString(),
        });
        await projectManager.updateProject(session.projectId, { chats: project.chats });
      }
    } catch (err) {
      console.error('Error saving response to history:', err);
    }
  });
}
