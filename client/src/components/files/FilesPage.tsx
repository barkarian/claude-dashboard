import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs.tsx';
import DiffOverview from '../diff/DiffOverview.tsx';
import FolderBrowser from './FolderBrowser.tsx';

interface FilesPageProps {
  projectId: string;
}

export default function FilesPage({ projectId }: FilesPageProps) {
  return (
    <Tabs defaultValue="folder" className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="flex-shrink-0 border-b border-border px-4">
        <TabsList>
          <TabsTrigger value="folder">Folder</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="folder"
        forceMount
        className="flex-1 flex flex-col overflow-hidden min-h-0 data-[state=inactive]:hidden"
      >
        <FolderBrowser projectId={projectId} />
      </TabsContent>

      <TabsContent
        value="changes"
        forceMount
        className="flex-1 flex flex-col overflow-hidden min-h-0 data-[state=inactive]:hidden"
      >
        <DiffOverview projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
