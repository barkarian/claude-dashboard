import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunningProcess } from '../../../../shared/types/models.ts';

interface MobileNavProps {
  projectId?: string;
  currentTab?: string;
  scriptCount?: number;
  changeCount?: number;
  processesWithPorts?: RunningProcess[];
}

export default function MobileNav({ projectId, currentTab, scriptCount = 0, changeCount = 0, processesWithPorts = [] }: MobileNavProps) {
  const navigate = useNavigate();
  const [showPortsPopover, setShowPortsPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const hasPorts = processesWithPorts.length > 0;

  // Close popover on outside click
  useEffect(() => {
    if (!showPortsPopover) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPortsPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPortsPopover]);

  function openPort(port: number, proc?: RunningProcess) {
    const url = proc?.tunnelUrls?.[port];
    window.open(url || `http://${window.location.hostname}:${port}`, '_blank');
  }

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

  function handleScriptsTabClick() {
    if (hasPorts) {
      setShowPortsPopover((prev) => !prev);
    } else {
      navigate(`/project/${projectId}/scripts`);
    }
  }

  // Project mode: Chats | Scripts & Ports (N) | Changes (N)
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
      label: hasPorts ? 'Scripts & Ports' : 'Scripts',
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
          const isScripts = tab.key === 'scripts';
          const badgeColor = isScripts && hasPorts ? 'bg-success' : 'bg-primary';

          return (
            <div key={tab.key} className="relative">
              <button
                onClick={() => {
                  if (isScripts) {
                    handleScriptsTabClick();
                  } else {
                    navigate(`/project/${projectId}/${tab.key}`);
                  }
                }}
                className={`relative flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors ${
                  isActive ? 'text-primary' : 'text-text-dim'
                }`}
              >
                <div className="relative">
                  {tab.icon}
                  {tab.count > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center ${badgeColor} text-white text-[10px] font-bold rounded-full`}>
                      {tab.count}
                    </span>
                  )}
                </div>
                {tab.label}
              </button>

              {/* Ports popover */}
              {isScripts && showPortsPopover && hasPorts && (
                <div
                  ref={popoverRef}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-bg-surface border border-border rounded-xl shadow-lg shadow-black/40 z-50 overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Running Ports</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPortsPopover(false);
                        navigate(`/project/${projectId}/scripts`);
                      }}
                      className="text-xs text-primary hover:text-primary-hover transition-colors"
                    >
                      All Scripts
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {processesWithPorts.map((proc) => {
                      const isShell = proc.scriptId.startsWith('shell-');
                      const displayLabel = isShell ? 'Terminal' : (proc.label || proc.command);
                      const ports = proc.detectedPorts || [];
                      return (
                        <div key={proc.scriptId} className="px-3 py-2.5 border-b border-border/50 last:border-b-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-2 h-2 rounded-full bg-success animate-pulse flex-shrink-0" />
                            <span className="text-sm font-medium text-text truncate flex-1">{displayLabel}</span>
                            {/* Terminal icon - navigate to script terminal */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowPortsPopover(false);
                                navigate(`/project/${projectId}/scripts/${proc.scriptId}`);
                              }}
                              className="p-1 rounded hover:bg-bg-hover text-text-dim hover:text-text transition-colors flex-shrink-0"
                              title="Open terminal"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                              </svg>
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 ml-4">
                            {ports.map((port) => (
                              <button
                                key={port}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPort(port, proc);
                                }}
                                className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono text-primary bg-primary/10 rounded-full hover:bg-primary/20 transition-colors"
                                title={`Open :${port} in new tab`}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                </svg>
                                :{port}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
