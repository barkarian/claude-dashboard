/**
 * ArtifactCard — renders a chat artifact emitted by the agent's
 * `display_artifact` tool. Image extensions render inline (preview);
 * everything else renders as a clickable file card.
 *
 * Bytes are NEVER embedded in the chat message — this card just builds
 * URLs into the existing /api/projects/:id/files/download endpoint
 * (via the env-aware buildDownloadUrl helper) so it works on tunnel,
 * desktop, and mobile alike.
 *
 * Click opens an in-app preview dialog wrapping the existing
 * FileContentView (the same viewer the Files tab uses) — no
 * target="_blank" so Tauri / Capacitor stay in-app.
 *
 * Download goes through downloadProjectFile which already handles
 * Capacitor Share on native + <a download> on the web.
 */

import { useState } from 'react';
import type { ChatArtifact } from '../../../../shared/types/models.ts';
import { buildDownloadUrl, downloadProjectFile } from '../../utils/downloadFile.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import FileContentView from '../files/FileContentView.tsx';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']);

function isImage(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTS.has(ext) : false;
}

function formatSize(size: number | null): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface ArtifactCardProps {
  artifact: ChatArtifact;
  projectId: string;
}

export default function ArtifactCard({ artifact, projectId }: ArtifactCardProps) {
  const filename = artifact.path.split('/').pop() || artifact.path;
  const label = artifact.label || filename;
  const inlineUrl = `${buildDownloadUrl(projectId, artifact.path)}&inline=1`;
  const sizeLabel = formatSize(artifact.size);
  const [previewOpen, setPreviewOpen] = useState(false);

  function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    downloadProjectFile(projectId, artifact.path).catch((err) => {
      console.error('Artifact download failed:', err);
    });
  }

  if (isImage(artifact.path)) {
    return (
      <>
        <div className="my-2 rounded-lg border border-border overflow-hidden bg-bg-surface max-w-md">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="block w-full"
            aria-label={`Open preview of ${label}`}
          >
            <img
              src={inlineUrl}
              alt={label}
              className="w-full h-auto object-contain max-h-96 cursor-zoom-in bg-bg"
              loading="lazy"
            />
          </button>
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
            <span className="truncate text-text-muted" title={artifact.path}>{label}</span>
            <button
              type="button"
              onClick={handleDownload}
              className="flex-shrink-0 ml-2 text-primary hover:underline"
            >
              Download
            </button>
          </div>
        </div>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl p-0 sm:max-w-3xl [&>button]:hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>{label}</DialogTitle>
            </DialogHeader>
            <div className="h-[80vh] flex flex-col">
              <FileContentView
                projectId={projectId}
                filePath={artifact.path}
                onBack={() => setPreviewOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Generic file card. Click anywhere → in-app preview dialog (FileContentView).
  // Download icon → downloadProjectFile (Capacitor Share on native, anchor on web).
  return (
    <>
      <div className="my-2 flex items-stretch rounded-lg border border-border bg-bg-surface max-w-md overflow-hidden">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="flex-1 flex items-center gap-3 px-3 py-2 hover:bg-bg-hover transition-colors min-w-0 text-left"
        >
          <svg className="w-8 h-8 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text font-medium truncate" title={label}>{label}</div>
            <div className="text-xs text-text-muted truncate">
              {sizeLabel}
              {filename !== label && sizeLabel && ' · '}
              {filename !== label && <span title={artifact.path}>{filename}</span>}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex-shrink-0 flex items-center justify-center px-3 border-l border-border text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
          title="Download"
          aria-label={`Download ${label}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl p-0 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div className="h-[80vh] flex flex-col">
            <FileContentView
              projectId={projectId}
              filePath={artifact.path}
              onBack={() => setPreviewOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
