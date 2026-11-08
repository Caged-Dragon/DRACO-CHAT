import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext.jsx';

const PresenceContext = createContext(null);

const HEARTBEAT_MS = 60 * 1000;

export function PresenceProvider({ children }) {
  const { user } = useAuth();
  // Map of userId -> true for everyone currently online
  const [onlineIds, setOnlineIds] = useState(new Set());
  const channelRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set());
      return;
    }

    const channel = supabase.channel('presence-global', {
      config: { presence: { key: user.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    channelRef.current = channel;

    // Keep last_seen_at fresh while the tab is open, so "last seen"
    // stays meaningful even between presence syncs.
    const heartbeat = setInterval(() => {
      supabase
        .from('chat_profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    }, HEARTBEAT_MS);
    supabase.from('chat_profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});

    return () => {
      clearInterval(heartbeat);
      supabase.removeChannel(channel);
    };
  }, [user]);

  function isOnline(userId) {
    return onlineIds.has(userId);
  }

  return (
    <PresenceContext.Provider value={{ onlineIds, isOnline }}>{children}</PresenceContext.Provider>
  );
}

export function usePresence() {
  return useContext(PresenceContext);
}
