import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface NewAgentContextValue {
  open: boolean;
  /** Optional initial prompt text to pre-fill the dialog with. */
  initialText: string;
  openDialog: (initialText?: string) => void;
  closeDialog: () => void;
}

const NewAgentContext = createContext<NewAgentContextValue>({
  open: false,
  initialText: '',
  openDialog: () => {},
  closeDialog: () => {},
});

export function NewAgentProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialText, setInitialText] = useState('');

  const openDialog = useCallback((initial?: string) => {
    setInitialText(initial ?? '');
    setOpen(true);
  }, []);
  const closeDialog = useCallback(() => setOpen(false), []);

  return (
    <NewAgentContext.Provider value={{ open, initialText, openDialog, closeDialog }}>
      {children}
    </NewAgentContext.Provider>
  );
}

export function useNewAgentDialog(): NewAgentContextValue {
  return useContext(NewAgentContext);
}
