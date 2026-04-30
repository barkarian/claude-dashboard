/**
 * previewService — generates compressed/HTML previews of large or
 * non-natively-renderable files and caches them under
 * `<workspace>/.claw/previews/`. Used by the file-download endpoint
 * (?variant=preview) and the artifact card / FileContentView.
 *
 * Per-format strategy:
 *   - image (png/jpg/webp/heic/gif/tiff/bmp/avif) → sharp: resize to max
 *     1600px on the long edge, JPEG quality 80, EXIF orientation honored.
 *   - pdf → pdftoppm (poppler): rasterize page 1 as JPEG @ 100 DPI.
 *   - docx → mammoth: convert to HTML (no images for now, prose only).
 *   - xlsx/xls → xlsx (SheetJS): every sheet rendered as an HTML table.
 *   - pptx → JSZip: extract the embedded `docProps/thumbnail.jpeg` (or
 *     png/jpg variants) — every PowerPoint export ships one.
 *   - video (mp4/mov/webm/mkv/m4v) → ffmpeg: poster frame at 1s,
 *     scaled to ≤1280px, JPEG.
 *
 * Cache key = sha256(absPath + mtimeMs + size + variant) truncated to
 * 16 chars. So if the source is edited the preview rebuilds; otherwise
 * it's served instantly from disk.
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileP = promisify(execFile);

type PreviewKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'video';

const EXT_TO_KIND: Record<string, PreviewKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
  heic: 'image', gif: 'image', tiff: 'image', bmp: 'image', avif: 'image',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx', xls: 'xlsx',
  pptx: 'pptx',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video',
};

const KIND_OUTPUT_EXT: Record<PreviewKind, 'jpg' | 'html'> = {
  image: 'jpg',
  pdf: 'jpg',
  docx: 'html',
  xlsx: 'html',
  pptx: 'jpg',
  video: 'jpg',
};

const KIND_MIME: Record<PreviewKind, string> = {
  image: 'image/jpeg',
  pdf: 'image/jpeg',
  docx: 'text/html; charset=utf-8',
  xlsx: 'text/html; charset=utf-8',
  pptx: 'image/jpeg',
  video: 'image/jpeg',
};

function getExt(p: string): string {
  return p.split('.').pop()?.toLowerCase() || '';
}

export interface PreviewMeta {
  available: boolean;
  /** Rough description of what the preview will be — drives client UI. */
  kind: PreviewKind | null;
  /** Bytes of the original source. */
  originalSize: number | null;
}

export function getPreviewInfo(absSourcePath: string): PreviewMeta {
  try {
    const stat = fs.statSync(absSourcePath);
    if (!stat.isFile()) return { available: false, kind: null, originalSize: null };
    const kind = EXT_TO_KIND[getExt(absSourcePath)];
    return { available: !!kind, kind: kind || null, originalSize: stat.size };
  } catch {
    return { available: false, kind: null, originalSize: null };
  }
}

function previewCacheDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.claw', 'previews');
}

function hashKey(absSourcePath: string, mtimeMs: number, size: number, variant: string): string {
  return crypto
    .createHash('sha256')
    .update(`${absSourcePath}|${mtimeMs}|${size}|${variant}`)
    .digest('hex')
    .slice(0, 16);
}

export interface PreviewResult {
  path: string;
  mime: string;
  size: number;
  kind: PreviewKind;
}

export async function getOrBuildPreview(
  workspaceRoot: string,
  absSourcePath: string,
): Promise<PreviewResult | null> {
  const kind = EXT_TO_KIND[getExt(absSourcePath)];
  if (!kind) return null;

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(absSourcePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const outExt = KIND_OUTPUT_EXT[kind];
  // Bump the version suffix when builder logic changes so old previews are regenerated.
  const variant = `${kind}-v1`;
  const key = hashKey(absSourcePath, stat.mtimeMs, stat.size, variant);
  const cacheDir = previewCacheDir(workspaceRoot);
  const cachedPath = path.join(cacheDir, `${key}.${outExt}`);

  // Cache hit
  try {
    const cs = await fsp.stat(cachedPath);
    if (cs.isFile() && cs.size > 0) {
      return { path: cachedPath, mime: KIND_MIME[kind], size: cs.size, kind };
    }
  } catch {
    // miss
  }

  // Cache miss — build
  await fsp.mkdir(cacheDir, { recursive: true });

  try {
    switch (kind) {
      case 'image': await buildImagePreview(absSourcePath, cachedPath); break;
      case 'pdf':   await buildPdfPreview(absSourcePath, cachedPath); break;
      case 'docx':  await buildDocxPreview(absSourcePath, cachedPath); break;
      case 'xlsx':  await buildXlsxPreview(absSourcePath, cachedPath); break;
      case 'pptx':  await buildPptxPreview(absSourcePath, cachedPath); break;
      case 'video': await buildVideoPreview(absSourcePath, cachedPath); break;
    }
  } catch (err: any) {
    console.error(`[preview] ${kind} build failed for ${absSourcePath}:`, err?.message || err);
    return null;
  }

  try {
    const cs = await fsp.stat(cachedPath);
    if (!cs.isFile() || cs.size === 0) return null;
    return { path: cachedPath, mime: KIND_MIME[kind], size: cs.size, kind };
  } catch {
    return null;
  }
}

// ── Per-kind builders ───────────────────────────────────────────────

async function buildImagePreview(src: string, dest: string): Promise<void> {
  await sharp(src, { failOn: 'none' })
    .rotate() // honor EXIF orientation
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(dest);
}

async function buildPdfPreview(src: string, dest: string): Promise<void> {
  // pdftoppm appends -1.jpg / -01.jpg depending on the version. Strip the
  // extension to give it a prefix, then look for whichever filename it produced.
  const tmpPrefix = dest.replace(/\.jpg$/, '');
  await execFileP(
    'pdftoppm',
    ['-jpeg', '-r', '100', '-f', '1', '-l', '1', src, tmpPrefix],
    { timeout: 30000 },
  );
  const candidates = [`${tmpPrefix}-1.jpg`, `${tmpPrefix}-01.jpg`];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (c !== dest) await fsp.rename(c, dest);
      return;
    }
  }
  throw new Error('pdftoppm produced no output file');
}

async function buildDocxPreview(src: string, dest: string): Promise<void> {
  const mammoth = await import('mammoth');
  // mammoth's default behavior is to inline every embedded image as a base64
  // data URI — a docx with even a few screenshots blows up to several MB of
  // HTML, defeating the point of a "preview". Replace images with a small
  // visible placeholder so prose preview stays light.
  const result = await mammoth.convertToHtml(
    { path: src },
    {
      convertImage: mammoth.images.imgElement(() => Promise.resolve({
        src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDgwIDYwIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iNjAiIGZpbGw9IiNlNWU3ZWIiLz48dGV4dCB4PSI0MCIgeT0iMzUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBmaWxsPSIjNmI3MjgwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5pbWFnZTwvdGV4dD48L3N2Zz4=',
        alt: '[image omitted in preview — download to view]',
      })),
    },
  );
  const body = result.value || '<p><em>(empty document)</em></p>';
  await fsp.writeFile(dest, wrapHtml(body), 'utf-8');
}

async function buildXlsxPreview(src: string, dest: string): Promise<void> {
  const xlsx = await import('xlsx');
  const wb = xlsx.readFile(src);
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const sheetHtml = xlsx.utils.sheet_to_html(sheet);
    parts.push(`<h2>${escapeHtml(sheetName)}</h2>${sheetHtml}`);
  }
  await fsp.writeFile(dest, wrapHtml(parts.join('\n')), 'utf-8');
}

async function buildPptxPreview(src: string, dest: string): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const buf = await fsp.readFile(src);
  const zip = await JSZip.loadAsync(buf);
  // Office Open XML standard puts the presentation thumbnail at this path.
  const candidates = [
    'docProps/thumbnail.jpeg',
    'docProps/thumbnail.jpg',
    'docProps/thumbnail.png',
  ];
  for (const c of candidates) {
    const file = zip.file(c);
    if (file) {
      const data = await file.async('nodebuffer');
      // Re-encode as JPEG so the cache mime stays consistent (handles PNG thumbs too).
      await sharp(data, { failOn: 'none' })
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(dest);
      return;
    }
  }
  throw new Error('No embedded thumbnail in pptx');
}

async function buildVideoPreview(src: string, dest: string): Promise<void> {
  // ffmpeg: jump 1s in, take one frame, scale to ≤1280 wide. -y overwrites.
  await execFileP(
    'ffmpeg',
    ['-y', '-ss', '1', '-i', src, '-vframes', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '5', dest],
    { timeout: 60000 },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #1a1a1a; background: #fff; }
    table { border-collapse: collapse; margin: 1em 0; max-width: 100%; }
    td, th { border: 1px solid #d4d4d8; padding: 4px 8px; text-align: left; vertical-align: top; }
    h1, h2, h3, h4 { margin-top: 1.5em; }
    img { max-width: 100%; height: auto; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
    @media (prefers-color-scheme: dark) {
      body { background: #0a0a0a; color: #e5e5e5; }
      td, th { border-color: #3f3f46; }
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
