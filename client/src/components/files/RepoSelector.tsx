import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../ui/drawer.tsx';
import { Badge } from '../ui/badge.tsx';
import { haptics } from '../../utils/haptics.ts';
import { filesStrings } from '../../utils/modeStrings.ts';
import type { RepoInfo, ProjectMode } from '../../../../shared/types/models.ts';

interface RepoSelectorProps {
  mode?: ProjectMode;
  repos: RepoInfo[];
  selectedRepo: RepoInfo | null;
  onSelect: (repo: RepoInfo) => void;
}

export default function RepoSelector({ mode = 'simple', repos, selectedRepo, onSelect }: RepoSelectorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isSimple = mode === 'simple';
  const nameFont = isSimple ? '' : 'font-mono';

  // Hide when 0 or 1 repo
  if (repos.length <= 1) return null;

  return (
    <div className="flex-shrink-0 border-b border-border px-4 py-2">
      <button
        onClick={() => { setSheetOpen(true); haptics.impactLight(); }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover-hover:border-border-light transition-colors min-w-0"
      >
        <svg className="w-3.5 h-3.5 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <span className={`${nameFont} text-text truncate max-w-[160px]`}>{selectedRepo?.name || '.'}</span>
        {selectedRepo && selectedRepo.changeCount > 0 && (
          <Badge variant="default" className="text-[10px] px-1.5 py-0 min-w-[18px] h-4 flex items-center justify-center">
            {selectedRepo.changeCount}
          </Badge>
        )}
        <svg className="w-3 h-3 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[80vh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle>{filesStrings[mode].repoDrawerTitle}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto flex-1 px-4 py-2 space-y-1">
            {repos.map((repo) => {
              const isSelected = selectedRepo?.repoPath === repo.repoPath;
              return (
                <button
                  key={repo.repoPath}
                  onClick={() => {
                    haptics.impactLight();
                    onSelect(repo);
                    setSheetOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
                    isSelected ? 'bg-primary/10 text-primary' : 'active:bg-bg-hover'
                  }`}
                >
                  <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <span className={`${nameFont} text-sm truncate flex-1`}>{repo.name}</span>
                  {repo.changeCount > 0 && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0 min-w-[18px] h-4 flex items-center justify-center">
                      {repo.changeCount}
                    </Badge>
                  )}
                  {isSelected && (
                    <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
