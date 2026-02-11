import { useSocket as useSocketCtx } from '../context/SocketContext.tsx';

export function useSocket() {
  return useSocketCtx();
}
