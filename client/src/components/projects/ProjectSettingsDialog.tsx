import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '../ui/drawer.tsx';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../ui/alert-dialog.tsx';
import { Checkbox } from '../ui/checkbox.tsx';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';
import { useAppSidebar } from '../../context/SidebarContext.tsx';
import { useAdapterSettings } from '../../hooks/useAdapterSettings.ts';
import SortableAdapterList from '../chat/SortableAdapterList.tsx';
import { toast } from 'sonner';

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectPath: string;
  shellOverride: string | null;
  defaultAdapter: string;
  adapterOrder: string[] | null;
  aiNamingEnabled: 'none' | 'on';
  pinned: boolean;
  mode: 'simple' | 'dev';
  onShellChanged?: () => void;
  onAdapterChanged?: () => void;
  onAiNamingChanged?: () => void;
  onPinChanged?: () => void;
  onModeChanged?: () => void;
}

interface ShellPreference {
  accountShell: string;
  isDefault: boolean;
  availableShells: string[];
}

export default function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectPath,
  shellOverride,
  adapterOrder,
  aiNamingEnabled,
  pinned,
  mode,
  onShellChanged,
  onAdapterChanged,
  onAiNamingChanged,
  onPinChanged,
  onModeChanged,
}: ProjectSettingsDialogProps) {
  const navigate = useNavigate();
  const { refreshProjects } = useAppSidebar();
  const { adapters: adapterInfos } = useAdapterSettings();

  // Pin state
  const [pinning, setPinning] = useState(false);

  // Mode state
  const [localMode, setLocalMode] = useState<'simple' | 'dev'>(mode);
  const [savingMode, setSavingMode] = useState(false);
  const modeChanged = localMode !== mode;
  const [unpushedCount, setUnpushedCount] = useState(0);

  async function handleSaveMode() {
    if (!modeChanged) return;
    setSavingMode(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { mode: localMode });
      toast.success(localMode === 'dev' ? 'Switched to Dev workspace' : 'Switched to Simple workspace');
      onModeChanged?.();
    } catch {
      toast.error('Failed to update workspace mode');
    } finally {
      setSavingMode(false);
    }
  }

  async function handleTogglePin() {
    setPinning(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { pinned: !pinned });
      toast.success(!pinned ? 'Pinned to sidebar' : 'Unpinned');
      onPinChanged?.();
      refreshProjects();
    } catch {
      toast.error('Failed to update pin');
    } finally {
      setPinning(false);
    }
  }

  // Shell state
  const [shellPref, setShellPref] = useState<ShellPreference | null>(null);
  const [localShellOverride, setLocalShellOverride] = useState<string>(shellOverride || '');
  const [savingShell, setSavingShell] = useState(false);

  // AI Naming state
  const [localAiNaming, setLocalAiNaming] = useState<string>(aiNamingEnabled || 'none');
  const [savingAiNaming, setSavingAiNaming] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [dirExists, setDirExists] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Advanced section is collapsed by default — Mode/Shell/AI-Naming are
  // changed irregularly so they shouldn't compete with everyday settings.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalShellOverride(shellOverride || '');
    setLocalAiNaming(aiNamingEnabled || 'none');
    setLocalMode(mode);
    // Fetch account shell preference
    api.get<ShellPreference>('/api/shell-preference')
      .then(setShellPref)
      .catch(() => {});
    // Fetch unpushed-count so we can warn before dev → simple
    if (mode === 'dev') {
      api.get<{ unpushedCount: number }>(`/api/projects/${projectId}/git-info`)
        .then((data) => setUnpushedCount(data.unpushedCount ?? 0))
        .catch(() => setUnpushedCount(0));
    } else {
      setUnpushedCount(0);
    }
  }, [open, shellOverride, aiNamingEnabled, mode, projectId]);

  async function handleSaveShell() {
    const newValue = localShellOverride || null;
    if (newValue === (shellOverride || null)) return;
    setSavingShell(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { shellOverride: newValue });
      toast.success(newValue ? `Shell set to ${newValue} for this project` : 'Shell reset to account default');
      onShellChanged?.();
    } catch {
      toast.error('Failed to update shell');
    } finally {
      setSavingShell(false);
    }
  }

  const aiNamingChanged = localAiNaming !== (aiNamingEnabled || 'none');

  async function handleSaveAiNaming() {
    if (!aiNamingChanged) return;
    setSavingAiNaming(true);
    try {
      await api.patch(`/api/projects/${projectId}`, { aiNamingEnabled: localAiNaming });
      toast.success(localAiNaming === 'on' ? 'AI chat naming enabled' : 'AI chat naming disabled');
      onAiNamingChanged?.();
    } catch {
      toast.error('Failed to update AI naming setting');
    } finally {
      setSavingAiNaming(false);
    }
  }

  async function openDeleteConfirm() {
    setShowDeleteConfirm(true);
    setDeleteFolder(false);
    setDirExists(null);
    try {
      const data = await api.get<{ exists: boolean }>(`/api/projects/${projectId}/directory-exists`);
      setDirExists(data.exists);
    } catch {
      setDirExists(false);
    }
  }

  async function handleDeleteProject() {
    setDeleting(true);
    try {
      await api.delete(`/api/projects/${projectId}`, { deleteFolder });
      toast.success(`Workspace "${projectName}" deleted`);
      setShowDeleteConfirm(false);
      onOpenChange(false);
      refreshProjects();
      navigate('/');
    } catch {
      toast.error('Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }

  function handleAdapterReorder(nextOrder: string[]) {
    api.patch(`/api/projects/${projectId}`, { adapterOrder: nextOrder })
      .then(() => onAdapterChanged?.())
      .catch(() => toast.error('Failed to save adapter order'));
  }

  const shellChanged = (localShellOverride || null) !== (shellOverride || null);
  // Adapter list filtered by mode: simple workspaces show every enabled
  // message-based adapter (claw-chat, opencode, …); terminal-only adapters
  // (claude-code) are dev-only. Filtered against the SAVED mode (not
  // localMode) so adapters don't flicker on toggle before save.
  const enabledAdapters = adapterInfos
    .filter(a => a.enabled)
    .filter(a => mode === 'dev' || !a.metadata.capabilities.terminal)
    .map(a => ({ metadata: a.metadata }));

  return (
    <>
      {/* Vaul handles scroll-vs-close natively when content scrolls. Adapter drag handles
          already carry data-vaul-no-drag, so dragging anywhere on the drawer body still
          closes it like the New Chat picker. */}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="px-4 pb-2 pt-1">
            <DrawerTitle className="text-base">Workspace Settings</DrawerTitle>
            <DrawerDescription className="sr-only">Settings for {projectName}</DrawerDescription>
          </DrawerHeader>

          {/* Scrollable body — vaul's handleOnly keeps this scroll area independent of the close gesture. */}
          <div className="overflow-y-auto overscroll-contain px-4 pb-6 space-y-4" style={{ maxHeight: 'calc(90vh - 72px)' }}>
            {/* Project info — compact single block */}
            <div>
              <p className="text-base font-semibold text-text truncate">{projectName}</p>
              <p className="text-xs text-text-muted font-mono mt-0.5 break-all">{projectPath}</p>
            </div>

            {/* Pin to sidebar */}
            <div className="border-t border-border pt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-text">{pinned ? 'Pinned to sidebar' : 'Pin to sidebar'}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {pinned ? 'Stays at the top of the sidebar.' : 'Pinned workspaces show instead of recent ones.'}
                </p>
              </div>
              <Button
                size="sm"
                variant={pinned ? 'outline' : 'default'}
                onClick={handleTogglePin}
                disabled={pinning}
                className="flex-shrink-0"
              >
                {pinning ? '...' : pinned ? 'Unpin' : 'Pin'}
              </Button>
            </div>

            {/* Chat Agents — drag-and-drop reorder. Visible in both modes whenever
                there are 2+ eligible adapters; mode controls eligibility (terminal
                adapters are dev-only). */}
            {enabledAdapters.length > 1 && (
              <div className="border-t border-border pt-3">
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Chat Agents</label>
                <p className="text-xs text-text-muted mt-0.5 mb-2">
                  Drag to reorder. The top agent is the default for new chats.
                </p>
                <SortableAdapterList
                  adapters={enabledAdapters}
                  adapterOrder={adapterOrder}
                  onReorder={handleAdapterReorder}
                />
              </div>
            )}

            {/* Advanced — collapsed by default (Mode, Terminal Shell, AI Naming
                are changed irregularly). */}
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 text-left"
                aria-expanded={advancedOpen}
              >
                <div>
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Advanced</span>
                  <p className="text-xs text-text-muted mt-0.5">Mode, terminal shell, AI naming</p>
                </div>
                <svg
                  className={`w-4 h-4 text-text-dim transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {advancedOpen && (
                <div className="mt-3 space-y-4">
                  {/* Workspace mode (Simple vs Dev) */}
                  <div>
                    <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Mode</label>
                    <p className="text-xs text-text-muted mt-0.5 mb-2">
                      {localMode === 'simple'
                        ? 'Clean Chats + Files surface. The agent uses the SDK adapter.'
                        : 'Power surface — Scripts tab, file path breadcrumb, and adapter choice.'}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex gap-1 p-0.5 bg-bg rounded-lg">
                        <button
                          type="button"
                          onClick={() => setLocalMode('simple')}
                          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                            localMode === 'simple'
                              ? 'bg-primary text-white'
                              : 'text-text-muted hover:text-text'
                          }`}
                        >
                          Simple
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocalMode('dev')}
                          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                            localMode === 'dev'
                              ? 'bg-primary text-white'
                              : 'text-text-muted hover:text-text'
                          }`}
                        >
                          Dev
                        </button>
                      </div>
                      {modeChanged && (
                        <Button size="sm" onClick={handleSaveMode} disabled={savingMode}>
                          {savingMode ? 'Saving...' : 'Save'}
                        </Button>
                      )}
                    </div>
                    {modeChanged && localMode === 'simple' && (
                      <p className="text-xs text-text-muted mt-2">
                        Existing Dev chats keep working in this workspace; new chats use the Simple adapter.
                      </p>
                    )}
                    {modeChanged && localMode === 'simple' && unpushedCount > 0 && (
                      <p className="text-xs text-warning mt-2">
                        You have {unpushedCount} unpushed change{unpushedCount !== 1 ? 's' : ''} that won't be visible in Simple mode. Push from the Git tab first if you want them on your remote.
                      </p>
                    )}
                  </div>

                  {/* Shell configuration */}
                  <div>
                    <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Terminal Shell</label>
                    <p className="text-xs text-text-muted mt-0.5 mb-2">
                      Account default: <span className="font-mono font-semibold text-text">{shellPref?.accountShell || '...'}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <select
                        value={localShellOverride}
                        onChange={(e) => setLocalShellOverride(e.target.value)}
                        className="flex-1 bg-bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors appearance-none cursor-pointer"
                      >
                        <option value="">Use account default ({shellPref?.accountShell || '...'})</option>
                        {(shellPref?.availableShells || []).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      {shellChanged && (
                        <Button size="sm" onClick={handleSaveShell} disabled={savingShell}>
                          {savingShell ? 'Saving...' : 'Save'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* AI Chat Naming */}
                  <div>
                    <label className="text-xs font-medium text-text-dim uppercase tracking-wider">AI Chat Naming</label>
                    <p className="text-xs text-text-muted mt-0.5 mb-2">
                      Auto-generate descriptive chat titles using AI on first message.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex gap-1 p-0.5 bg-bg rounded-lg">
                        <button
                          type="button"
                          onClick={() => setLocalAiNaming('none')}
                          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                            localAiNaming === 'none'
                              ? 'bg-primary text-white'
                              : 'text-text-muted hover:text-text'
                          }`}
                        >
                          Off
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocalAiNaming('on')}
                          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                            localAiNaming === 'on'
                              ? 'bg-primary text-white'
                              : 'text-text-muted hover:text-text'
                          }`}
                        >
                          On
                        </button>
                      </div>
                      {aiNamingChanged && (
                        <Button size="sm" onClick={handleSaveAiNaming} disabled={savingAiNaming}>
                          {savingAiNaming ? 'Saving...' : 'Save'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Danger zone */}
            <div className="border-t border-border pt-3">
              <label className="text-xs font-medium text-danger uppercase tracking-wider">Danger Zone</label>
              <p className="text-xs text-text-muted mt-0.5 mb-2">
                Permanently delete this workspace and all its chats and scripts.
              </p>
              <Button variant="danger" size="sm" onClick={openDeleteConfirm}>
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete Workspace
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong className="text-text">"{projectName}"</strong>? This will remove all chats and scripts associated with this workspace. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {dirExists === null ? (
            <div className="flex items-center gap-2 py-2">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
              <span className="text-xs text-text-dim">Checking directory...</span>
            </div>
          ) : dirExists ? (
            <label className="flex items-center gap-2 py-2 cursor-pointer select-none">
              <Checkbox
                checked={deleteFolder}
                onCheckedChange={(checked) => setDeleteFolder(checked === true)}
              />
              <span className="text-sm text-text">Delete the workspace folder as well</span>
            </label>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-warning/10 border border-warning/30">
              <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-xs text-warning">This is an obsolete workspace — there is no directory linked to it.</span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteProject(); }}
              disabled={deleting}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
