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
  onShellChanged?: () => void;
  onAdapterChanged?: () => void;
  onAiNamingChanged?: () => void;
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
  onShellChanged,
  onAdapterChanged,
  onAiNamingChanged,
}: ProjectSettingsDialogProps) {
  const navigate = useNavigate();
  const { refreshProjects } = useAppSidebar();
  const { adapters: adapterInfos } = useAdapterSettings();

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

  useEffect(() => {
    if (!open) return;
    setLocalShellOverride(shellOverride || '');
    setLocalAiNaming(aiNamingEnabled || 'none');
    // Fetch account shell preference
    api.get<ShellPreference>('/api/shell-preference')
      .then(setShellPref)
      .catch(() => {});
  }, [open, shellOverride, aiNamingEnabled]);

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
      toast.success(`Project "${projectName}" deleted`);
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
  const enabledAdapters = adapterInfos.filter(a => a.enabled).map(a => ({ metadata: a.metadata }));

  return (
    <>
      {/* Vaul handles scroll-vs-close natively when content scrolls. Adapter drag handles
          already carry data-vaul-no-drag, so dragging anywhere on the drawer body still
          closes it like the New Chat picker. */}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="px-4 pb-2 pt-1">
            <DrawerTitle className="text-base">Project Settings</DrawerTitle>
            <DrawerDescription className="sr-only">Settings for {projectName}</DrawerDescription>
          </DrawerHeader>

          {/* Scrollable body — vaul's handleOnly keeps this scroll area independent of the close gesture. */}
          <div className="overflow-y-auto overscroll-contain px-4 pb-6 space-y-5" style={{ maxHeight: 'calc(90vh - 72px)' }}>
            {/* Project info */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Name</label>
                <p className="text-sm text-text mt-0.5">{projectName}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Path</label>
                <p className="text-xs text-text-muted font-mono mt-0.5 break-all">{projectPath}</p>
              </div>
            </div>

            {/* Chat adapters (reorder + default) */}
            {enabledAdapters.length > 0 && (
              <div className="border-t border-border pt-4">
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Chat Agents</label>
                <p className="text-xs text-text-muted mt-0.5 mb-3">
                  Drag to reorder. The top agent is the default for new chats.
                </p>
                <SortableAdapterList
                  adapters={enabledAdapters}
                  adapterOrder={adapterOrder}
                  onReorder={handleAdapterReorder}
                />
              </div>
            )}

            {/* Shell configuration */}
            <div className="border-t border-border pt-4">
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
            <div className="border-t border-border pt-4">
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

            {/* Danger zone */}
            <div className="border-t border-border pt-4">
              <label className="text-xs font-medium text-danger uppercase tracking-wider">Danger Zone</label>
              <p className="text-xs text-text-muted mt-0.5 mb-2">
                Permanently delete this project and all its chats and scripts.
              </p>
              <Button variant="danger" size="sm" onClick={openDeleteConfirm}>
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete Project
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong className="text-text">"{projectName}"</strong>? This will remove all chats and scripts associated with this project. This action cannot be undone.
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
              <span className="text-sm text-text">Delete the project folder as well</span>
            </label>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-warning/10 border border-warning/30">
              <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-xs text-warning">This is an obsolete project — there is no directory linked to it.</span>
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
