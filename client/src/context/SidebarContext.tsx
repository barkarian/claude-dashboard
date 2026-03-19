import { createContext, useContext } from 'react';

interface AppSidebarContextValue {
  refreshProjects: () => void;
}

export const AppSidebarContext = createContext<AppSidebarContextValue>({
  refreshProjects: () => {},
});

export function useAppSidebar() {
  return useContext(AppSidebarContext);
}
