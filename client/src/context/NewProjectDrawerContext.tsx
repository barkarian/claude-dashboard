import { createContext, useContext, useState, type ReactNode } from 'react';

interface NewProjectDrawerContextValue {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const NewProjectDrawerContext = createContext<NewProjectDrawerContextValue>({
  isOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function NewProjectDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <NewProjectDrawerContext.Provider value={{
      isOpen,
      openDrawer: () => setIsOpen(true),
      closeDrawer: () => setIsOpen(false),
    }}>
      {children}
    </NewProjectDrawerContext.Provider>
  );
}

export function useNewProjectDrawer() {
  return useContext(NewProjectDrawerContext);
}
