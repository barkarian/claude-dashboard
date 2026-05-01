import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs.tsx';
import DiffOverview from '../diff/DiffOverview.tsx';
import FolderBrowser from './FolderBrowser.tsx';
import GitPanel from '../git/GitPanel.tsx';
import BranchSelector from './BranchSelector.tsx';
import RepoSelector from './RepoSelector.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import type { RepoInfo } from '../../../../shared/types/models.ts';

interface FilesPageProps {
  projectId: string;
  repos: RepoInfo[];
  selectedRepo: RepoInfo | null;
  onSelectRepo: (repo: RepoInfo) => void;
  onRepoRefresh?: () => void;
}

export default function FilesPage({ projectId, repos, selectedRepo, onSelectRepo, onRepoRefresh }: FilesPageProps) {
  const { project } = useProject();
  const mode = project?.mode ?? 'simple';
  const isSimple = mode === 'simple';

  const [branchKey, setBranchKey] = useState(0);
  const handleBranchChange = useCallback(() => setBranchKey(k => k + 1), []);

  const handleSelectRepo = useCallback((repo: RepoInfo) => {
    onSelectRepo(repo);
    setBranchKey(k => k + 1);
  }, [onSelectRepo]);

  const repoPath = selectedRepo?.repoPath;

  const changesTabValue = isSimple ? 'saves' : 'changes';

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <RepoSelector mode={mode} repos={repos} selectedRepo={selectedRepo} onSelect={handleSelectRepo} />
      {!isSimple && (
        <BranchSelector projectId={projectId} repoPath={repoPath} onBranchChange={handleBranchChange} />
      )}

      <Tabs defaultValue="folder" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-shrink-0 border-b border-border px-4">
          <TabsList>
            <TabsTrigger value="folder">Folder</TabsTrigger>
            <TabsTrigger value={changesTabValue}>{isSimple ? 'Saves' : 'Changes'}</TabsTrigger>
            {!isSimple && <TabsTrigger value="git">Git</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent
          value="folder"
          forceMount
          className="flex-1 flex flex-col overflow-hidden min-h-0 data-[state=inactive]:hidden"
        >
          <FolderBrowser key={`folder-${branchKey}`} projectId={projectId} />
        </TabsContent>

        <TabsContent
          value={changesTabValue}
          forceMount
          className="flex-1 flex flex-col overflow-hidden min-h-0 data-[state=inactive]:hidden"
        >
          <DiffOverview key={`diff-${branchKey}`} mode={mode} projectId={projectId} repoPath={repoPath} onRepoRefresh={onRepoRefresh} />
        </TabsContent>

        {!isSimple && (
          <TabsContent
            value="git"
            forceMount
            className="flex-1 flex flex-col overflow-hidden min-h-0 data-[state=inactive]:hidden"
          >
            <GitPanel key={`git-${branchKey}`} projectId={projectId} repoPath={repoPath} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
