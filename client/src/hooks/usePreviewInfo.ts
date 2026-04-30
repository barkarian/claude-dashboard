import { useEffect, useState } from 'react';
import api from '../utils/api.ts';

export type PreviewKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'video';

export interface PreviewInfo {
  available: boolean;
  kind: PreviewKind | null;
  originalSize: number | null;
}

const EMPTY: PreviewInfo = { available: false, kind: null, originalSize: null };

/**
 * Fetches /api/projects/:id/files/preview-info for the given file path. Used
 * by ArtifactCard (download dropdown) and FileContentView (image quality
 * toggle, office iframe rendering) to know whether a compressed/HTML preview
 * is available before requesting it.
 */
export function usePreviewInfo(projectId: string, filePath: string | null): PreviewInfo {
  const [info, setInfo] = useState<PreviewInfo>(EMPTY);

  useEffect(() => {
    if (!filePath) { setInfo(EMPTY); return; }
    let cancelled = false;
    api
      .get<PreviewInfo>(`/api/projects/${projectId}/files/preview-info?path=${encodeURIComponent(filePath)}`)
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch(() => { if (!cancelled) setInfo(EMPTY); });
    return () => { cancelled = true; };
  }, [projectId, filePath]);

  return info;
}
