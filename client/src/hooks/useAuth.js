import { useAuth as useAuthCtx } from '../context/AuthContext.jsx';

export function useAuth() {
  return useAuthCtx();
}
