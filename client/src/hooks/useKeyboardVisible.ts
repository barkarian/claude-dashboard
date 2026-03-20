import { useState, useEffect } from 'react';
import { isCapacitorNative } from '../utils/platform.ts';
import { getPlugin, resolveHandle } from '../utils/capacitorBridge.ts';

interface KeyboardState {
  visible: boolean;
  height: number;
}

export function useKeyboardVisible(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ visible: false, height: 0 });

  useEffect(() => {
    // Native: use Capacitor Keyboard plugin for reliable events
    if (isCapacitorNative()) {
      const kb = getPlugin('Keyboard');
      if (!kb) return;

      let showHandle: { remove: () => void } | null = null;
      let hideHandle: { remove: () => void } | null = null;

      resolveHandle(
        kb.addListener('keyboardWillShow', (info) => {
          setState({ visible: true, height: info.keyboardHeight });
        }),
        (h) => { showHandle = h; },
      );
      resolveHandle(
        kb.addListener('keyboardWillHide', () => {
          setState({ visible: false, height: 0 });
        }),
        (h) => { hideHandle = h; },
      );

      return () => {
        showHandle?.remove();
        hideHandle?.remove();
      };
    }

    // Browser fallback: visualViewport heuristic
    const vv = window.visualViewport;
    if (!vv) return;

    function onResize() {
      const diff = window.innerHeight - vv!.height;
      const keyboardOpen = diff > 150;
      setState({ visible: keyboardOpen, height: keyboardOpen ? diff : 0 });
    }

    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return state;
}
