import { useSocket as useSocketCtx } from '../context/SocketContext.jsx';

export function useSocket() {
  return useSocketCtx();
}
