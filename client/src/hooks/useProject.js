import { useProject as useProjectCtx } from '../context/ProjectContext.jsx';

export function useProjectHook() {
  return useProjectCtx();
}
