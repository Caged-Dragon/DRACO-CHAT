import { useEffect, useState } from 'react';
import { flushOutbox, getOutbox, subscribeOutbox } from '../utils/outbox.js';
import { supabase } from '../supabaseClient';

// The queued (not-yet-delivered) messages for this user, kept live.
export function useOutbox(uid) {
  const [items, setItems] = useState(() => getOutbox(uid));
  useEffect(() => {
    setItems(getOutbox(uid));
    return subscribeOutbox(() => setItems(getOutbox(uid)));
  }, [uid]);
  return items;
}

// Mounted once for the signed-in user: delivers the queue when the network
// returns, when the tab becomes visible again, and periodically while
// anything is waiting.
export function useOutboxFlusher(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    const run = () => flushOutbox(supabase, uid);
    run();
    window.addEventListener('online', run);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (getOutbox(uid).some((i) => !i.failed)) run();
    }, 10000);
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [uid]);
}
