// Shared ref: when a Claude Code chat is active, swipe gestures map to arrow keys
// instead of opening the sidebar. The CC chat view registers a handler on mount.
export const ccSwipeOverride = {
  current: null as ((direction: 'up' | 'down' | 'left' | 'right') => void) | null,
  // Only swipes starting inside this element trigger arrow keys.
  // Swipes on the prompt area / keys bar are ignored.
  containerEl: null as HTMLElement | null,
};
