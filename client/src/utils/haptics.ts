import { isCapacitorNative } from './platform.ts';
import { getPlugin } from './capacitorBridge.ts';

function run(fn: () => void) {
  if (!isCapacitorNative()) return;
  try { fn(); } catch { /* no-op */ }
}

export const haptics = {
  impactLight:          () => run(() => getPlugin('Haptics')?.impact({ style: 'Light' })),
  impactMedium:         () => run(() => getPlugin('Haptics')?.impact({ style: 'Medium' })),
  notificationSuccess:  () => run(() => getPlugin('Haptics')?.notification({ type: 'SUCCESS' })),
  notificationWarning:  () => run(() => getPlugin('Haptics')?.notification({ type: 'WARNING' })),
  notificationError:    () => run(() => getPlugin('Haptics')?.notification({ type: 'ERROR' })),
};
