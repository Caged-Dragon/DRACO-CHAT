import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function GlobalSearchModal({ onClose, onOpenFriend, onOpenGroup }) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messageHits, setMessageHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = query.trim();
    if (!term) {
      setFriends([]);
      setGroups([]);
      setMessageHits([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(term), 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function runSearch(term) {
    const { data: friendRows } = await supabase
      .from('chat_friendships')
      .select(
        `
        requester_id, addressee_id,
        requester:chat_profiles!chat_friendships_requester_id_fkey(id, username, avatar_url),
        addressee:chat_profiles!chat_friendships_addressee_id_fkey(id, username, avatar_url)
      `
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const allFriends = (friendRows || []).map((row) =>
      row.requester_id === user.id ? row.addressee : row.requester
    );
    setFriends(allFriends.filter((f) => f.username.toLowerCase().includes(term.toLowerCase())));

    const { data: groupRows } = await supabase
      .from('chat_group_members')
      .select('groups:chat_groups(id, name)')
      .eq('user_id', user.id);
    const allGroups = (groupRows || []).map((r) => r.groups).filter(Boolean);
    setGroups(allGroups.filter((g) => g.name.toLowerCase().includes(term.toLowerCase())));

    const { data: msgRows } = await supabase
      .from('chat_messages')
      .select('id, content, sender_id, receiver_id, created_at')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .ilike('content', `%${term}%`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(15);

    const hitsWithFriend = [];
    for (const m of msgRows || []) {
      const otherId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
      const other = allFriends.find((f) => f.id === otherId);
      if (other) hitsWithFriend.push({ ...m, friend: other });
    }
    setMessageHits(hitsWithFriend);
    setLoading(false);
  }

  const hasResults = friends.length > 0 || groups.length > 0 || messageHits.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Search everything</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <input
          type="text"
          placeholder="Search friends, groups, and messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {loading && <p className="dim small">Searching...</p>}

        {friends.length > 0 && (
          <div className="global-search-section">
            <h4>Friends</h4>
            {friends.map((f) => (
              <div
                key={f.id}
                className="global-search-row"
                onClick={() => {
                  onOpenFriend(f);
                  onClose();
                }}
              >
                {f.username}
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 && (
          <div className="global-search-section">
            <h4>Groups</h4>
            {groups.map((g) => (
              <div
                key={g.id}
                className="global-search-row"
                onClick={() => {
                  onOpenGroup(g);
                  onClose();
                }}
              >
                👥 {g.name}
              </div>
            ))}
          </div>
        )}

        {messageHits.length > 0 && (
          <div className="global-search-section">
            <h4>Messages</h4>
            {messageHits.map((m) => (
              <div
                key={m.id}
                className="global-search-row global-search-message"
                onClick={() => {
                  onOpenFriend(m.friend);
                  onClose();
                }}
              >
                <span className="global-search-message-from">{m.friend.username}</span>
                <span className="global-search-message-text">{m.content}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && query.trim() && !hasResults && (
          <p className="dim small">No results for "{query.trim()}".</p>
        )}
      </div>
    </div>
  );
}
