import { createContext, useContext } from 'react';

interface SidebarContextValue {
  openSidebar: () => void;
  refreshProjects: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  openSidebar: () => {},
  refreshProjects: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}
