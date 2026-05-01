/**
 * NewAgentDialog — global "spin up an agent" command box.
 *
 * UI: workspace pill at the top-left, single rounded prompt block below
 * with an inline agent picker pill at the bottom. Submit with ⌘↵ or the
 * send button. Mirrors the GPT-style command bar.
 *
 * Behaviour: creates a chat in the chosen project (Home is get-or-create,
 * "+ New project" hands off to the new-workspace flow), saves the typed
 * prompt as the chat's draft, optimistically injects it into ProjectContext
 * so the routed view can find it, asks the sidebar to refetch (so a freshly-
 * created Home shows up immediately), then navigates with state.autoSend so
 * the chat view fires the message once the session is ready.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover.tsx';
import api from '../../utils/api.ts';
import { useAdapterSettings } from '../../hooks/useAdapterSettings.ts';
import { useNewAgentDialog } from '../../context/NewAgentContext.tsx';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useAppSidebar } from '../../context/SidebarContext.tsx';
import type { Chat, Project, ProjectSummary } from '../../../../shared/types/models.ts';

const HOME_OPTION = '__home__';
const NEW_PROJECT_OPTION = '__new__';
const PREFERRED_ADAPTER = 'claw-chat';

export default function NewAgentDialog() {
  const navigate = useNavigate();
  const { open, initialText, closeDialog } = useNewAgentDialog();
  const { adapters, enabledIds } = useAdapterSettings();
  const { openDrawer: openNewProjectDrawer } = useNewProjectDrawer();
  const { setProject } = useProject();
  const { refreshProjects } = useAppSidebar();

  const [prompt, setPrompt] = useState('');
  const [projectChoice, setProjectChoice] = useState<string>(HOME_OPTION);
  const [adapterChoice, setAdapterChoice] = useState<string>('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const defaultAdapter = useMemo(() => {
    if (enabledIds.includes(PREFERRED_ADAPTER)) return PREFERRED_ADAPTER;
    return enabledIds[0] ?? '';
  }, [enabledIds]);

  // Reset/seed whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPrompt(initialText);
    setProjectChoice(HOME_OPTION);
    setAdapterChoice(defaultAdapter);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 50);
  }, [open, initialText, defaultAdapter]);

  // Load projects for the picker the first time the dialog opens.
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
      shortLabel: a.metadata.shortLabel,
    })),
    [adapters],
  );

  const selectedAdapter = adapterOptions.find(a => a.id === adapterChoice);

  const projectLabel = projectChoice === HOME_OPTION
    ? 'Home'
    : projects.find(p => p.id === projectChoice)?.name ?? 'Workspace';

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
      closeDialog();
      openNewProjectDrawer();
      return;
    }
    setSubmitting(true);
    try {
      let projectId: string;
      if (projectChoice === HOME_OPTION) {
        const home = await api.get<{ project: Project }>('/api/projects?home=ensure');
        projectId = home.project.id;
      } else {
        projectId = projectChoice;
      }

      const chatRes = await api.post<{ chat: Chat }>(
        `/api/projects/${projectId}/chats`,
        { label: 'New Chat', adapter: adapterChoice },
      );
      const chat = chatRes.chat;

      const draftedChat = { ...chat, draftMessage: text };
      await api.put(`/api/projects/${projectId}/chats/${chat.id}/draft`, { text });

      // Optimistically inject when we're already on the destination project.
      setProject(prev => {
        if (!prev || prev.id !== projectId) return prev;
        const rest = prev.chats.filter(c => c.id !== chat.id);
        return { ...prev, chats: [draftedChat, ...rest] };
      });

      // Re-fetch sidebar so a freshly-created Home shows its row.
      refreshProjects();

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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Workspace picker entries: Home pinned, then existing (excluding any
  // project named "Home" so we never list it twice), then the inline new-
  // project shortcut.
  const projectEntries = useMemo(() => {
    const rest = projects.filter(p => p.name !== 'Home');
    return [
      { id: HOME_OPTION, label: 'Home', isHome: true },
      ...rest.map(p => ({ id: p.id, label: p.name, isHome: false })),
      { id: NEW_PROJECT_OPTION, label: '+ New project…', isHome: false, isNew: true as const },
    ];
  }, [projects]);

  const canSubmit = !submitting && !!prompt.trim() && !!adapterChoice;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
      <DialogContent
        className="max-w-2xl p-4 sm:p-5 gap-3 bg-bg-surface border-border"
      >
        {/* a11y: Radix requires a title; keep it visually hidden so the
            command-bar layout matches the mock. */}
        <DialogTitle className="sr-only">New Agent</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a workspace and an agent, type a prompt, and send.
        </DialogDescription>

        {/* Workspace pill — top-left */}
        <div className="flex items-center gap-2">
          <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-text hover:text-primary transition-colors"
              >
                <span>{projectLabel}</span>
                <svg className="w-3.5 h-3.5 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1">
              {projectEntries.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.id === NEW_PROJECT_OPTION) {
                      setProjectMenuOpen(false);
                      closeDialog();
                      openNewProjectDrawer();
                      return;
                    }
                    setProjectChoice(p.id);
                    setProjectMenuOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-sm hover:bg-bg-hover transition-colors ${
                    projectChoice === p.id ? 'text-primary' : 'text-text'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {/* Tiny computer/laptop glyph as in the mock — purely decorative,
              indicates "this runs on your machine". */}
          <svg className="w-4 h-4 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
          </svg>
        </div>

        {/* Prompt block: rounded card with textarea + bottom action bar */}
        <div className="border border-border rounded-2xl bg-bg/40 px-3 pt-3 pb-2 focus-within:border-primary/60 transition-colors">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder="Plan, Build, / for commands, @ for context"
            rows={4}
            className="w-full bg-transparent text-sm text-text placeholder:text-text-dim focus:outline-none resize-none min-h-[80px]"
          />

          <div className="flex items-center gap-2 mt-1">
            {/* + attach (placeholder — wired up later for file attachments) */}
            <button
              type="button"
              disabled
              title="Attach (coming soon)"
              className="flex-shrink-0 w-7 h-7 rounded-full bg-bg-surface border border-border flex items-center justify-center text-text-dim opacity-60 cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            {/* Agent picker pill */}
            <Popover open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors px-1"
                >
                  <span>{selectedAdapter?.shortLabel || selectedAdapter?.label || 'Agent'}</span>
                  <svg className="w-3 h-3 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-48 p-1">
                {adapterOptions.length === 0 && (
                  <div className="px-2.5 py-2 text-xs text-text-muted">No agents enabled</div>
                )}
                {adapterOptions.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAdapterChoice(a.id);
                      setAgentMenuOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-sm hover:bg-bg-hover transition-colors ${
                      adapterChoice === a.id ? 'text-primary' : 'text-text'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Send button — sits where the mock's mic is, mirrors that affordance */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              title="Send (⌘↵)"
              className="ml-auto flex-shrink-0 w-8 h-8 rounded-full bg-text text-bg flex items-center justify-center transition-opacity disabled:opacity-30 hover:opacity-90"
            >
              {submitting ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
