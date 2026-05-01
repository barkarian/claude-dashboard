/**
 * NewAgentDialog — global "spin up an agent" command box.
 *
 * Big prompt textarea on top, project + adapter selectors below. Submit
 * creates a chat with the selected adapter in the chosen project (creating
 * the Home workspace lazily when needed) and pre-fills the chat's draft
 * with the typed prompt so the chat page lands ready-to-send.
 *
 * Triggered by Cmd+N or the Catalog page's "New Agent" button.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog.tsx';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';
import { useAdapterSettings } from '../../hooks/useAdapterSettings.ts';
import { useNewAgentDialog } from '../../context/NewAgentContext.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import type { Chat, Project, ProjectSummary } from '../../../../shared/types/models.ts';

const HOME_OPTION = '__home__';
const NEW_PROJECT_OPTION = '__new__';
const PREFERRED_ADAPTER = 'claw-chat';

export default function NewAgentDialog() {
  const navigate = useNavigate();
  const { open, initialText, closeDialog } = useNewAgentDialog();
  const { adapters, enabledIds } = useAdapterSettings();
  const { openDrawer: openNewProjectDrawer } = useNewProjectDrawer();

  const [prompt, setPrompt] = useState('');
  const [projectChoice, setProjectChoice] = useState<string>(HOME_OPTION);
  const [adapterChoice, setAdapterChoice] = useState<string>('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pick a sensible default adapter: prefer claw-chat (Chat) when enabled,
  // otherwise the first enabled one.
  const defaultAdapter = useMemo(() => {
    if (enabledIds.includes(PREFERRED_ADAPTER)) return PREFERRED_ADAPTER;
    return enabledIds[0] ?? '';
  }, [enabledIds]);

  // Reset/seed the form whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPrompt(initialText);
    setProjectChoice(HOME_OPTION);
    setAdapterChoice(defaultAdapter);
    // Focus + caret-at-end after the modal mounts.
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 50);
  }, [open, initialText, defaultAdapter]);

  // Load projects for the picker the first time the dialog opens. Cheap
  // enough — just the summary list, not chat content.
  useEffect(() => {
    if (!open || projects.length > 0) return;
    api.get<{ projects: ProjectSummary[] }>('/api/projects')
      .then(data => setProjects(data.projects || []))
      .catch(() => {});
  }, [open, projects.length]);

  const adapterOptions = useMemo(
    () => adapters.filter(a => a.enabled).map(a => ({
      id: a.metadata.id,
      label: a.metadata.displayName || a.metadata.id,
    })),
    [adapters],
  );

  async function handleSubmit() {
    const text = prompt.trim();
    if (!text) {
      toast.error('Type something first');
      return;
    }
    if (!adapterChoice) {
      toast.error('Pick an agent first');
      return;
    }
    if (projectChoice === NEW_PROJECT_OPTION) {
      // Hand off to the existing new-project flow. The user can come back
      // and trigger New Agent again with the new workspace.
      closeDialog();
      openNewProjectDrawer();
      return;
    }
    setSubmitting(true);
    try {
      // 1. Resolve the project. Home is get-or-create.
      let projectId: string;
      if (projectChoice === HOME_OPTION) {
        const home = await api.get<{ project: Project }>('/api/projects?home=ensure');
        projectId = home.project.id;
      } else {
        projectId = projectChoice;
      }

      // 2. Create the chat with the chosen adapter.
      const chatRes = await api.post<{ chat: Chat }>(
        `/api/projects/${projectId}/chats`,
        { label: 'New Chat', adapter: adapterChoice },
      );
      const chat = chatRes.chat;

      // 3. Stash the typed prompt as the chat's draft so the prompt input
      //    pre-fills with it. The chat view sees state.autoSend=true and
      //    fires the send once the session is ready.
      await api.put(`/api/projects/${projectId}/chats/${chat.id}/draft`, { text });

      closeDialog();
      navigate(`/project/${projectId}/chats/${chat.id}`, {
        state: { isNewChat: true, adapter: chat.adapter, autoSend: true },
      });
    } catch (err: any) {
      console.error('New Agent submit failed:', err);
      toast.error(err?.message || 'Failed to start agent');
    } finally {
      setSubmitting(false);
    }
  }

  function onPromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter submits. Plain Enter still inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
          <DialogDescription>
            Spin up an agent on any workspace. Prompt below, pick where it runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder="What should the agent do?"
            rows={6}
            className="w-full px-3 py-2.5 text-sm bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-primary transition-colors resize-y min-h-[120px]"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] font-medium text-text-dim uppercase tracking-wider mb-1">Project</span>
              <select
                value={projectChoice}
                onChange={(e) => setProjectChoice(e.target.value)}
                className="w-full px-2.5 py-2 text-sm bg-bg-surface border border-border rounded-md text-text focus:outline-none focus:border-primary transition-colors"
              >
                <option value={HOME_OPTION}>🏠  Home</option>
                {projects
                  .filter(p => p.name !== 'Home') // already surfaced above
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                <option value={NEW_PROJECT_OPTION}>+ New project…</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-[11px] font-medium text-text-dim uppercase tracking-wider mb-1">Agent</span>
              <select
                value={adapterChoice}
                onChange={(e) => setAdapterChoice(e.target.value)}
                disabled={adapterOptions.length === 0}
                className="w-full px-2.5 py-2 text-sm bg-bg-surface border border-border rounded-md text-text focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
              >
                {adapterOptions.length === 0 ? (
                  <option>No agents enabled</option>
                ) : (
                  adapterOptions.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <span className="text-[11px] text-text-dim mr-auto self-center">
            <kbd className="px-1.5 py-0.5 rounded bg-bg border border-border font-mono">⌘↵</kbd> to submit
          </span>
          <Button variant="outline" onClick={closeDialog} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !prompt.trim() || !adapterChoice}>
            {submitting ? 'Starting…' : 'Start agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
