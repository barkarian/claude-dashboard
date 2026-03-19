import { useState, useCallback, useMemo, useEffect } from 'react';
import { Tree } from 'react-arborist';
import { useProjectFiles } from '../../hooks/useProjectFiles.ts';
import { buildFileTree, type TreeNode } from '../../utils/buildFileTree.ts';
import { getFileIcon } from '../../utils/fileIcons.ts';
import api from '../../utils/api.ts';
import FileContentView from './FileContentView.tsx';
import type { DiffResult } from '../../../../shared/types/models.ts';

type FileStatus = 'added' | 'modified' | 'deleted';

interface FolderBrowserProps {
  projectId: string;
}

export default function FolderBrowser({ projectId }: FolderBrowserProps) {
  const { files, loading } = useProjectFiles(projectId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [changedFiles, setChangedFiles] = useState<Map<string, FileStatus>>(new Map());

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

  // Fetch git diff status to color changed files
  useEffect(() => {
    api
      .get<DiffResult>(`/api/projects/${projectId}/diff`)
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
      if (status === 'added') return 'text-green-400';
      if (status === 'modified') return 'text-yellow-400';
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
            <div
              ref={dragHandle}
              style={style}
              className={`flex items-center gap-2 px-3 cursor-pointer hover:bg-bg-hover rounded text-sm ${
                node.isSelected ? 'bg-bg-hover' : ''
              }`}
              onClick={() => {
                if (node.isLeaf) {
                  setSelectedFile(node.id);
                } else {
                  node.toggle();
                }
              }}
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
                className={`truncate ${node.isLeaf ? '' : 'font-medium'} ${getNameColor(node.id, node.isLeaf)}`}
              >
                {node.data.name}
              </span>
            </div>
          )}
        </Tree>
      ) : null}
    </div>
  );
}
