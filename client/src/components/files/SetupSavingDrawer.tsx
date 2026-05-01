import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '../ui/drawer.tsx';
import { Button } from '../ui/button.tsx';
import { Checkbox } from '../ui/checkbox.tsx';
import api from '../../utils/api.ts';
import { formatBytes } from '../../utils/formatBytes.ts';
import type { ProjectMode } from '../../../../shared/types/models.ts';
import { toast } from 'sonner';

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  fileCount: number;
  suggestedExclude: boolean;
}

interface DirScanResult {
  path: string;
  entries: DirEntry[];
  totalSize: number;
  totalFiles: number;
  truncated?: boolean;
}

interface SetupSavingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  repoPath?: string;
  mode: ProjectMode;
  onComplete: () => void;
}

const SMALL_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const SMALL_FILE_COUNT = 500;

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function isAncestorExcluded(p: string, excluded: Set<string>): boolean {
  if (!p) return false;
  const parts = p.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (excluded.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

function buildGitignore(excluded: Set<string>, entriesByPath: Map<string, DirEntry>): string {
  const lines: string[] = [];
  // Include only "top-most" excluded entries (drop ones whose ancestor is also excluded)
  const sorted = Array.from(excluded).sort();
  for (const p of sorted) {
    if (isAncestorExcluded(p, excluded)) continue;
    const entry = entriesByPath.get(p);
    if (entry?.isDir) lines.push(`${p}/`);
    else lines.push(p);
  }
  return lines.join('\n');
}

export default function SetupSavingDrawer({
  open,
  onOpenChange,
  projectId,
  repoPath,
  mode,
  onComplete,
}: SetupSavingDrawerProps) {
  const isSimple = mode === 'simple';
  const [scans, setScans] = useState<Map<string, DirScanResult>>(new Map());
  const [entriesByPath, setEntriesByPath] = useState<Map<string, DirEntry>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [gitignoreText, setGitignoreText] = useState('');
  const [overrideGitignore, setOverrideGitignore] = useState(false);

  const repoQuery = repoPath ? `&repoPath=${encodeURIComponent(repoPath)}` : '';

  const fetchScan = useCallback(async (relPath: string) => {
    const url = `/api/projects/${projectId}/dir-scan?path=${encodeURIComponent(relPath)}${repoQuery}`;
    return api.get<DirScanResult>(url);
  }, [projectId, repoQuery]);

  // Initial root scan
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingRoot(true);
    setScans(new Map());
    setEntriesByPath(new Map());
    setExpanded(new Set());
    setExcluded(new Set());
    setOverrideGitignore(false);
    setAdvancedOpen(false);
    fetchScan('')
      .then((data) => {
        if (cancelled) return;
        const newEntries = new Map<string, DirEntry>();
        const initialExcluded = new Set<string>();
        for (const e of data.entries) {
          const p = e.name;
          newEntries.set(p, e);
          if (e.suggestedExclude) initialExcluded.add(p);
        }
        setScans(new Map([['', data]]));
        setEntriesByPath(newEntries);
        setExcluded(initialExcluded);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to scan folder');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingRoot(false);
      });
    return () => { cancelled = true; };
  }, [open, fetchScan]);

  const root = scans.get('');
  const isSmall = !!root && root.totalSize <= SMALL_SIZE_BYTES && root.totalFiles <= SMALL_FILE_COUNT;
  const showPicker = !isSmall || mode === 'dev';

  // Keep textarea in sync with picker selections, until user takes over.
  const computedGitignore = useMemo(() => buildGitignore(excluded, entriesByPath), [excluded, entriesByPath]);
  useEffect(() => {
    if (!overrideGitignore) setGitignoreText(computedGitignore);
  }, [computedGitignore, overrideGitignore]);

  async function handleExpand(relPath: string, entry: DirEntry) {
    if (!entry.isDir) return;
    if (expanded.has(relPath)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(relPath));
    if (scans.has(relPath)) return;
    setLoadingPaths((prev) => new Set(prev).add(relPath));
    try {
      const data = await fetchScan(relPath);
      setScans((prev) => new Map(prev).set(relPath, data));
      setEntriesByPath((prev) => {
        const next = new Map(prev);
        for (const e of data.entries) next.set(joinRel(relPath, e.name), e);
        return next;
      });
    } catch {
      toast.error(`Failed to scan ${relPath}`);
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
    }
  }

  function toggleExclude(relPath: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) {
        next.delete(relPath);
      } else {
        // Adding a parent — remove any descendants already in the set (parent covers them).
        for (const existing of next) {
          if (existing.startsWith(`${relPath}/`)) next.delete(existing);
        }
        next.add(relPath);
      }
      return next;
    });
  }

  async function handleConfirm() {
    setSubmitting(true);
    const gitignoreContent = (mode === 'dev' && overrideGitignore)
      ? gitignoreText
      : computedGitignore;
    try {
      await api.post(`/api/projects/${projectId}/git-init`, {
        repoPath,
        gitignoreContent,
        initialCommit: true,
      });
      toast.success(isSimple ? 'Saving turned on' : 'Git initialized');
      onComplete();
      onOpenChange(false);
    } catch {
      toast.error(isSimple ? 'Failed to turn on saving' : 'Failed to initialize git');
    } finally {
      setSubmitting(false);
    }
  }

  function renderEntries(relParent: string, entries: DirEntry[], depth: number) {
    return entries.map((entry) => {
      const fullPath = joinRel(relParent, entry.name);
      const ancestorExcluded = isAncestorExcluded(fullPath, excluded);
      const isChecked = excluded.has(fullPath) || ancestorExcluded;
      const isOpen = expanded.has(fullPath);
      const isLoading = loadingPaths.has(fullPath);
      const childScan = scans.get(fullPath);
      return (
        <div key={fullPath}>
          <div
            className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-bg-hover transition-colors ${ancestorExcluded ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {entry.isDir ? (
              <button
                type="button"
                onClick={() => handleExpand(fullPath, entry)}
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-text-dim hover:text-text"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
              >
                <svg
                  className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ) : (
              <span className="flex-shrink-0 w-4" />
            )}
            <Checkbox
              checked={isChecked}
              disabled={ancestorExcluded || submitting}
              onCheckedChange={() => !ancestorExcluded && toggleExclude(fullPath)}
              aria-label={`Exclude ${fullPath}`}
            />
            <span className="flex-shrink-0 text-text-dim">
              {entry.isDir ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              )}
            </span>
            <span className="text-sm text-text truncate flex-1 min-w-0">{entry.name}</span>
            <span className="text-xs text-text-dim flex-shrink-0 whitespace-nowrap">
              {formatBytes(entry.size)}
              {entry.isDir && entry.fileCount > 0 && ` · ${entry.fileCount} file${entry.fileCount !== 1 ? 's' : ''}`}
            </span>
          </div>
          {isOpen && entry.isDir && (
            <div>
              {isLoading && (
                <div className="text-xs text-text-dim py-1.5" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
                  Scanning…
                </div>
              )}
              {childScan && childScan.entries.length === 0 && !isLoading && (
                <div className="text-xs text-text-dim py-1.5" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
                  Empty folder
                </div>
              )}
              {childScan && renderEntries(fullPath, childScan.entries, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  }

  const title = isSimple ? 'Turn on Saves' : 'Set up Git';
  const description = isSimple
    ? 'Pick anything you don’t want included in saves.'
    : 'Pick anything you don’t want tracked, or edit .gitignore directly.';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] flex flex-col">
        <DrawerHeader className="px-4 pb-2 pt-1">
          <DrawerTitle className="text-base">{title}</DrawerTitle>
          <DrawerDescription className="text-xs">{description}</DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto overscroll-contain px-4 pb-2 flex-1" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {loadingRoot ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : !root ? (
            <p className="text-sm text-text-muted py-8 text-center">Could not scan this folder.</p>
          ) : (
            <>
              <div className="text-xs text-text-muted mb-3 flex items-center gap-2">
                <span>{formatBytes(root.totalSize)}</span>
                <span>·</span>
                <span>{root.totalFiles.toLocaleString()} file{root.totalFiles !== 1 ? 's' : ''}</span>
                {root.truncated && <span className="text-warning">(truncated)</span>}
              </div>

              {isSmall && isSimple && (
                <div className="text-sm text-text-muted py-4">
                  This folder is small enough to save as-is. You can confirm without excluding anything.
                </div>
              )}

              {showPicker && (
                <div className="border border-border rounded-md py-1">
                  {renderEntries('', root.entries, 0)}
                </div>
              )}

              {mode === 'dev' && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(v => !v)}
                    className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    Edit .gitignore directly
                  </button>
                  {advancedOpen && (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={gitignoreText}
                        onChange={(e) => {
                          setGitignoreText(e.target.value);
                          setOverrideGitignore(true);
                        }}
                        rows={8}
                        spellCheck={false}
                        placeholder="node_modules/&#10;dist/&#10;.env"
                        className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-xs font-mono text-text placeholder-text-dim focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y"
                      />
                      {overrideGitignore && (
                        <button
                          type="button"
                          onClick={() => { setOverrideGitignore(false); setGitignoreText(computedGitignore); }}
                          className="text-xs text-primary hover:text-primary/80"
                        >
                          Reset from selections
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-shrink-0 px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={submitting || loadingRoot || !root}>
            {submitting ? (isSimple ? 'Turning on…' : 'Initializing…') : (isSimple ? 'Turn on Saves' : 'Initialize')}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
