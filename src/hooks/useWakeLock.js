import { useEffect } from 'react';

// Keeps the screen on while `active` is true (e.g. during a call) so the
// phone doesn't lock and drop the call. Safe to use where unsupported.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) {
          l.release().catch(() => {});
          return;
        }
        lock = l;
      } catch {
        // denied (e.g. low battery) — ignore
      }
    };

    // The lock is released automatically when the tab is hidden; re-take it on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [active]);
}
