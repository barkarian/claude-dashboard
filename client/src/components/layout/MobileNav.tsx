import { useNavigate } from 'react-router-dom';

interface MobileNavProps {
  projectId?: string;
  currentTab?: string;
  scriptCount?: number;
  changeCount?: number;
}

export default function MobileNav({ projectId, currentTab, scriptCount = 0, changeCount = 0 }: MobileNavProps) {
  const navigate = useNavigate();

  // Non-project mode: just show Projects link (rendered from App.tsx for non-project pages)
  if (!projectId) {
    return (
      <nav className="md:hidden flex-shrink-0 bg-bg-surface border-t border-border safe-area-inset-bottom">
        <div className="flex items-center justify-around h-14">
          <button
            onClick={() => navigate('/')}
            className="flex flex-col items-center gap-0.5 px-3 py-1 text-xs text-primary transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            Projects
          </button>
        </div>
      </nav>
    );
  }

  // Project mode: Chats | Scripts (N) | Changes (N)
  const tabs = [
    {
      key: 'chats',
      label: 'Chats',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
      count: 0,
    },
    {
      key: 'scripts',
      label: 'Scripts',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
      count: scriptCount,
    },
    {
      key: 'diff',
      label: 'Changes',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
      count: changeCount,
    },
  ];

  return (
    <nav className="md:hidden flex-shrink-0 bg-bg-surface border-t border-border safe-area-inset-bottom">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(`/project/${projectId}/${tab.key}`)}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors ${
                isActive ? 'text-primary' : 'text-text-dim'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {tab.count > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-primary text-white text-[10px] font-bold rounded-full">
                    {tab.count}
                  </span>
                )}
              </div>
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
