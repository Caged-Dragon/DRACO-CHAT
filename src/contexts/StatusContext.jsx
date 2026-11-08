import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/image.js';
import { useAuth } from './AuthContext.jsx';

const StatusContext = createContext(null);

export function StatusProvider({ children }) {
  const { user } = useAuth();
  // { [userId]: { user: {id,username,avatar_url}, statuses: [...] } }
  const [statusGroups, setStatusGroups] = useState({});
  const [viewedIds, setViewedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const loadStatuses = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // RLS already restricts this to: my own statuses, plus active
    // (not-yet-expired) statuses from accepted friends.
    const { data, error } = await supabase
      .from('chat_statuses')
      .select('*, user:chat_profiles(id, username, avatar_url)')
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const groups = {};
    data.forEach((s) => {
      if (!groups[s.user_id]) groups[s.user_id] = { user: s.user, statuses: [] };
      groups[s.user_id].statuses.push(s);
    });
    setStatusGroups(groups);

    // Which of these have I already viewed?
    const { data: views } = await supabase
      .from('chat_status_views')
      .select('status_id')
      .eq('viewer_id', user.id);

    setViewedIds(new Set((views || []).map((v) => v.status_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setStatusGroups({});
      setViewedIds(new Set());
      return;
    }
    loadStatuses();

    // Live updates: a friend posting a new status, or anyone's status
    // aging past expiry, should refresh without a manual reload.
    const channel = supabase
      .channel(`statuses-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_statuses' }, () => {
        loadStatuses();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user, loadStatuses]);

  async function postTextStatus(text, backgroundColor) {
    const { error } = await supabase.from('chat_statuses').insert({
      user_id: user.id,
      content_type: 'text',
      text_content: text.trim(),
      background_color: backgroundColor,
    });
    if (!error) loadStatuses();
    return { error };
  }

  async function postImageStatus(rawFile, caption) {
    const file = await compressImage(rawFile, { maxDim: 1280, quality: 0.82 });
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('chat-status-media').upload(path, file);
    if (uploadError) return { error: uploadError };

    const { data: pub } = supabase.storage.from('chat-status-media').getPublicUrl(path);
    const { error } = await supabase.from('chat_statuses').insert({
      user_id: user.id,
      content_type: 'image',
      media_url: pub.publicUrl,
      text_content: caption?.trim() || null,
    });
    if (!error) loadStatuses();
    return { error };
  }

  async function deleteStatus(statusId) {
    const { error } = await supabase.from('chat_statuses').delete().eq('id', statusId);
    if (!error) loadStatuses();
    return { error };
  }

  async function markViewed(statusId) {
    if (viewedIds.has(statusId)) return;
    setViewedIds((prev) => new Set(prev).add(statusId));
    await supabase.from('chat_status_views').insert({ status_id: statusId, viewer_id: user.id });
  }

  async function getViewers(statusId) {
    const { data } = await supabase
      .from('chat_status_views')
      .select('viewer_id, viewed_at, viewer:chat_profiles(id, username, avatar_url)')
      .eq('status_id', statusId)
      .order('viewed_at', { ascending: false });
    return data || [];
  }

  const myGroup = user ? statusGroups[user.id] : null;
  const friendGroups = Object.values(statusGroups).filter((g) => g.user.id !== user?.id);

  return (
    <StatusContext.Provider
      value={{
        myGroup,
        friendGroups,
        viewedIds,
        loading,
        postTextStatus,
        postImageStatus,
        deleteStatus,
        markViewed,
        getViewers,
        refresh: loadStatuses,
      }}
    >
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  return useContext(StatusContext);
}
