import { useAuth as useAuthCtx } from '../context/AuthContext.tsx';

export function useAuth() {
  return useAuthCtx();
}
