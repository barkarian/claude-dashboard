import type { ProjectMode } from '../../../shared/types/models.ts';

type FileStatusKey = 'added' | 'modified' | 'deleted' | 'untracked' | 'renamed';

export const fileStatusLabel: Record<ProjectMode, Record<FileStatusKey, string>> = {
  simple: {
    added: 'new',
    modified: 'changed',
    deleted: 'removed',
    untracked: 'new',
    renamed: 'changed',
  },
  dev: {
    added: 'added',
    modified: 'modified',
    deleted: 'deleted',
    untracked: 'untracked',
    renamed: 'renamed',
  },
};

export const filesStrings = {
  simple: {
    saveButton: 'Save',
    saving: 'Saving...',
    placeholder: 'Describe this save (optional)',
    discardAll: 'Discard unsaved changes',
    discardConfirm: 'Discard all unsaved changes? This cannot be undone.',
    nothingChangedTitle: 'Everything is saved',
    nothingChangedHint: "Make some edits and they'll show up here.",
    pendingHeader: (n: number) => `${n} file${n !== 1 ? 's' : ''} with unsaved changes`,
    pastSavesHeader: 'Past Saves',
    repoDrawerTitle: 'Select Folder',
    undoFile: 'Undo changes',
  },
  dev: {
    saveButton: 'Commit',
    saving: 'Committing...',
    placeholder: 'Commit message...',
    discardAll: 'Revert All',
    discardConfirm: 'Revert all changes? This cannot be undone.',
    nothingChangedTitle: 'No changes',
    nothingChangedHint: 'Working directory is clean',
    pendingHeader: (n: number) => `${n} file${n !== 1 ? 's' : ''} changed`,
    pastSavesHeader: 'History',
    repoDrawerTitle: 'Select Repository',
    undoFile: 'Revert',
  },
} as const;

export function defaultSaveMessage(now: Date = new Date()): string {
  return `Save ${now.toLocaleString()}`;
}
