/**
 * Browser lockdown hook: monitors visibility, window blur, fullscreen exit, clipboard actions,
 * context menu, and devtools shortcuts during an active exam sitting.
 */
import { useEffect, useRef } from 'react';

export function useBrowserLockdown({ enabled, requireFullscreen, onEvent }) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;

    let lastTabEventAt = 0;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastTabEventAt = Date.now();
        onEventRef.current?.('tab_hidden', 'Candidate switched away from the exam tab');
      }
    };

    const handleWindowBlur = () => {
      // Avoid double-counting when tab switch fires both blur and visibilitychange together.
      if (Date.now() - lastTabEventAt < 800) return;
      lastTabEventAt = Date.now();
      onEventRef.current?.('window_blur', 'Exam window lost focus');
    };

    const handleFullscreenChange = () => {
      if (requireFullscreen && !document.fullscreenElement) {
        onEventRef.current?.('fullscreen_exit', 'Candidate exited fullscreen mode');
      }
    };

    const handleCopyOrCut = (event) => {
      event.preventDefault();
      onEventRef.current?.('copy_attempt', `Blocked ${event.type} action`);
    };

    const handlePaste = (event) => {
      event.preventDefault();
      onEventRef.current?.('paste_attempt', 'Blocked clipboard paste');
    };

    const handleContextMenu = (event) => {
      event.preventDefault();
      onEventRef.current?.('context_menu', 'Blocked context menu');
    };

    const handleKeyDown = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === 'F12' || (mod && event.shiftKey && ['i', 'j', 'c'].includes(key))) {
        event.preventDefault();
        onEventRef.current?.('devtools_open', 'Blocked developer tools shortcut');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('copy', handleCopyOrCut, true);
    document.addEventListener('cut', handleCopyOrCut, true);
    document.addEventListener('paste', handlePaste, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('copy', handleCopyOrCut, true);
      document.removeEventListener('cut', handleCopyOrCut, true);
      document.removeEventListener('paste', handlePaste, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, requireFullscreen]);
}

