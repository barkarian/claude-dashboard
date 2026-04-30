/**
 * ArtifactCard — renders a chat artifact emitted by the agent's
 * `display_artifact` tool. Image extensions render inline (preview);
 * everything else renders as a clickable file card.
 *
 * Bytes are NEVER embedded in the chat message — this card just builds
 * URLs into the existing /api/projects/:id/files/download endpoint, which
 * already handles MIME types, inline previews (?inline=1), and downloads.
 */

import type { ChatArtifact } from '../../../../shared/types/models.ts';

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
  const encoded = encodeURIComponent(artifact.path);
  const inlineUrl = `/api/projects/${projectId}/files/download?path=${encoded}&inline=1`;
  const downloadUrl = `/api/projects/${projectId}/files/download?path=${encoded}`;
  const sizeLabel = formatSize(artifact.size);

  if (isImage(artifact.path)) {
    return (
      <div className="my-2 rounded-lg border border-border overflow-hidden bg-bg-surface max-w-md">
        <a href={inlineUrl} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={inlineUrl}
            alt={label}
            className="w-full h-auto object-contain max-h-96 cursor-zoom-in bg-bg"
            loading="lazy"
          />
        </a>
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
          <span className="truncate text-text-muted" title={artifact.path}>{label}</span>
          <a
            href={downloadUrl}
            className="flex-shrink-0 ml-2 text-primary hover:underline"
            download
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  // Generic file card. Click anywhere → open inline preview in new tab.
  // Download icon → save to disk.
  return (
    <div className="my-2 flex items-stretch rounded-lg border border-border bg-bg-surface max-w-md overflow-hidden">
      <a
        href={inlineUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 flex items-center gap-3 px-3 py-2 hover:bg-bg-hover transition-colors min-w-0"
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
      </a>
      <a
        href={downloadUrl}
        download
        className="flex-shrink-0 flex items-center justify-center px-3 border-l border-border text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
        title="Download"
        aria-label={`Download ${label}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </a>
    </div>
  );
}
