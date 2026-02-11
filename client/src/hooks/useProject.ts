import { useProject as useProjectCtx } from '../context/ProjectContext.tsx';

export function useProjectHook() {
  return useProjectCtx();
}
