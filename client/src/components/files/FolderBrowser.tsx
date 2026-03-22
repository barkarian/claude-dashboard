import { useState, useCallback, useMemo, useEffect } from 'react';
import { Tree } from 'react-arborist';
import { useProjectFiles } from '../../hooks/useProjectFiles.ts';
import { buildFileTree, type TreeNode } from '../../utils/buildFileTree.ts';
import { getFileIcon } from '../../utils/fileIcons.ts';
import { useIsMobile } from '../../hooks/use-mobile.tsx';
import { useLongPress } from '../../hooks/useLongPress.ts';
import ContextMenu from '../ui/ContextMenu.tsx';
import api from '../../utils/api.ts';
import FileContentView from './FileContentView.tsx';

type FileStatus = 'added' | 'modified' | 'deleted' | 'untracked' | 'renamed';

interface StatusFile {
  path: string;
  status: string;
}

interface FolderBrowserProps {
  projectId: string;
}

function triggerDownload(projectId: string, filePath: string) {
  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  const base = envMatch ? envMatch[0] : '';
  const url = `${base}/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function FolderBrowser({ projectId }: FolderBrowserProps) {
  const { files, loading } = useProjectFiles(projectId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [changedFiles, setChangedFiles] = useState<Map<string, FileStatus>>(new Map());
  const isMobile = useIsMobile();
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; position: { x: number; y: number }; filePath: string }>({
    open: false,
    position: { x: 0, y: 0 },
    filePath: '',
  });

  const treeData = useMemo(() => buildFileTree(files), [files]);

  // Callback ref so ResizeObserver attaches whenever the div mounts
  const observerRef = useMemo(() => ({ current: null as ResizeObserver | null }), []);
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (node) {
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            setHeight(entry.contentRect.height);
          }
        });
        ro.observe(node);
        observerRef.current = ro;
      }
    },
    [observerRef],
  );

  // Fetch lightweight git status (paths + statuses only, no diff content)
  useEffect(() => {
    api
      .get<{ files: StatusFile[] }>(`/api/projects/${projectId}/status`)
      .then((data) => {
        const map = new Map<string, FileStatus>();
        for (const f of data.files || []) {
          map.set(f.path, f.status as FileStatus);
        }
        setChangedFiles(map);
      })
      .catch(() => setChangedFiles(new Map()));
  }, [projectId]);

  // Directories that contain changed files
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const [filePath] of changedFiles) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return dirs;
  }, [changedFiles]);

  if (selectedFile) {
    return (
      <FileContentView
        projectId={projectId}
        filePath={selectedFile}
        onBack={() => setSelectedFile(null)}
      />
    );
  }

  function getNameColor(nodeId: string, isLeaf: boolean): string {
    if (isLeaf) {
      const status = changedFiles.get(nodeId);
      if (status === 'added' || status === 'untracked') return 'text-green-400';
      if (status === 'modified' || status === 'renamed') return 'text-yellow-400';
      if (status === 'deleted') return 'text-red-400';
      return 'text-text';
    }
    if (changedDirs.has(nodeId)) return 'text-yellow-300';
    return 'text-text';
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden min-h-0">
      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center pt-12">
          <p className="text-text-muted text-sm">No files found</p>
        </div>
      ) : height > 0 ? (
        <Tree<TreeNode>
          data={treeData}
          idAccessor="id"
          openByDefault={false}
          width="100%"
          height={height}
          indent={16}
          rowHeight={32}
          paddingBottom={32}
        >
          {({ node, style, dragHandle }) => (
            <FileTreeRow
              node={node}
              style={style}
              dragHandle={dragHandle}
              isMobile={isMobile}
              projectId={projectId}
              getNameColor={getNameColor}
              onSelect={setSelectedFile}
              onLongPress={(pos, filePath) => setCtxMenu({ open: true, position: pos, filePath })}
            />
          )}
        </Tree>
      ) : null}
      <ContextMenu
        open={ctxMenu.open}
        onClose={() => setCtxMenu(prev => ({ ...prev, open: false }))}
        position={ctxMenu.position}
        items={[
          {
            label: 'Download',
            icon: (
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            ),
            onAction: () => triggerDownload(projectId, ctxMenu.filePath),
          },
        ]}
      />
    </div>
  );
}

// Extracted row component so useLongPress hook is called per-row (hooks can't be inside render callbacks)
interface FileTreeRowProps {
  node: any;
  style: React.CSSProperties;
  dragHandle: any;
  isMobile: boolean;
  projectId: string;
  getNameColor: (nodeId: string, isLeaf: boolean) => string;
  onSelect: (filePath: string) => void;
  onLongPress: (position: { x: number; y: number }, filePath: string) => void;
}

function FileTreeRow({ node, style, dragHandle, isMobile, projectId, getNameColor, onSelect, onLongPress }: FileTreeRowProps) {
  const longPress = useLongPress((pos) => {
    if (node.isLeaf) {
      onLongPress(pos, node.id);
    }
  });

  const handleClick = () => {
    if (node.isLeaf) {
      onSelect(node.id);
    } else {
      node.toggle();
    }
  };

  return (
    <div
      ref={dragHandle}
      style={{
        ...style,
        ...(isMobile && node.isLeaf ? {
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'pan-y',
        } as React.CSSProperties : {}),
      }}
      className={`flex items-center gap-2 px-3 cursor-pointer hover:bg-bg-hover rounded text-sm group ${
        node.isSelected ? 'bg-bg-hover' : ''
      }`}
      onClick={handleClick}
      {...(isMobile && node.isLeaf ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onContextMenu: longPress.onContextMenu,
      } : {})}
    >
      {node.isLeaf ? (
        <span className="text-xs w-5 text-center flex-shrink-0">
          {getFileIcon(node.data.name)}
        </span>
      ) : (
        <svg
          className={`w-4 h-4 text-text-dim flex-shrink-0 transition-transform ${
            node.isOpen ? 'rotate-90' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      )}
      <span
        className={`truncate flex-1 ${node.isLeaf ? '' : 'font-medium'} ${getNameColor(node.id, node.isLeaf)}`}
      >
        {node.data.name}
      </span>
      {/* Desktop-only download button */}
      {!isMobile && node.isLeaf && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            triggerDownload(projectId, node.id);
          }}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded hover:bg-bg-surface text-text-dim hover:text-text transition-all"
          title="Download"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
