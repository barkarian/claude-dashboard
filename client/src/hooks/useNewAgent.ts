/**
 * useNewAgent — global "New Agent" trigger.
 *
 * Opens the NewAgentDialog (mounted at the app root). The dialog handles
 * project selection (default Home), adapter selection (default claw-chat),
 * prompt entry, chat creation, and navigation.
 *
 * Used by the Catalog page button and the Cmd/Ctrl+N global hotkey.
 */

import { useNewAgentDialog } from '../context/NewAgentContext.tsx';

export function useNewAgent() {
  const { openDialog } = useNewAgentDialog();
  return {
    /** Open the New Agent command box. Optional initial prompt text. */
    startNewAgent: (initialText?: string) => openDialog(initialText),
  };
}
