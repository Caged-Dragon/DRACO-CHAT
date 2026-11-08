import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext.jsx';
import { useChatPrefs } from './ChatPrefsContext.jsx';

const UnreadContext = createContext(null);

export function UnreadProvider({ children }) {
  const { user } = useAuth();
  const { getPref } = useChatPrefs();
  // { [senderId]: count } for direct chats, { [groupId]: count } for groups
  const [counts, setCounts] = useState({});
  const [groupCounts, setGroupCounts] = useState({});
  const activeGroupRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setCounts({});
      setGroupCounts({});
      return undefined;
    }
    loadCounts();
    loadGroupCounts();

    const channel = supabase
      .channel(`unread-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `receiver_id=eq.${user.id}` },
        (payload) => {
          const senderId = payload.new.sender_id;
          setCounts((prev) => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_group_messages' },
        (payload) => {
          const m = payload.new;
          if (m.sender_id === user.id || m.deleted_at) return;
          if (activeGroupRef.current === m.group_id) return;
          setGroupCounts((prev) => ({ ...prev, [m.group_id]: (prev[m.group_id] || 0) + 1 }));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Muted chats stay visible in the list but don't count toward the
  // browser-tab title or the app-icon badge.
  const total =
    Object.entries(counts).reduce((sum, [id, n]) => sum + (getPref('f', id).muted ? 0 : n), 0) +
    Object.entries(groupCounts).reduce((sum, [id, n]) => sum + (getPref('g', id).muted ? 0 : n), 0);

  useEffect(() => {
    document.title = total > 0 ? `(${total}) Dragon Chat` : 'Dragon Chat';
    try {
      if (total > 0 && navigator.setAppBadge) navigator.setAppBadge(total);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch {
      // Badging isn't supported everywhere — ignore.
    }
  }, [total]);

  async function loadCounts() {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('sender_id')
      .eq('receiver_id', user.id)
      .is('read_at', null);

    if (error) return;
    const next = {};
    for (const row of data) {
      next[row.sender_id] = (next[row.sender_id] || 0) + 1;
    }
    setCounts(next);
  }

  async function loadGroupCounts() {
    const { data, error } = await supabase.rpc('chat_group_unread_counts');
    if (error) return;
    const next = {};
    (data || []).forEach((row) => {
      if (Number(row.unread) > 0) next[row.group_id] = Number(row.unread);
    });
    setGroupCounts(next);
  }

  // Call when opening a chat with `friendId` — marks their messages to
  // you as read, both in the database and in local state.
  async function markRead(friendId) {
    setCounts((prev) => {
      if (!prev[friendId]) return prev;
      const next = { ...prev };
      delete next[friendId];
      return next;
    });

    await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId)
      .eq('receiver_id', user.id)
      .is('read_at', null);
  }

  const markGroupRead = useCallback(
    async (groupId) => {
      setGroupCounts((prev) => {
        if (!prev[groupId]) return prev;
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      if (!user) return;
      await supabase
        .from('chat_group_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('user_id', user.id);
    },
    [user]
  );

  const setActiveGroup = useCallback((groupId) => {
    activeGroupRef.current = groupId;
  }, []);

  return (
    <UnreadContext.Provider value={{ counts, groupCounts, total, markRead, markGroupRead, setActiveGroup }}>
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread() {
  return useContext(UnreadContext);
}
