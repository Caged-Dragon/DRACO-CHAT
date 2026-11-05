import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';
import { usePresence } from '../contexts/PresenceContext.jsx';
import { useUnread } from '../contexts/UnreadContext.jsx';
import { useChatPrefs } from '../contexts/ChatPrefsContext.jsx';
import Avatar from './Avatar.jsx';
import ReportModal from './ReportModal.jsx';
import { formatLastSeen } from '../utils/format.js';

export default function FriendsList({ refreshKey, activeFriendId, onSelectFriend }) {
  const { user } = useAuth();
  const { isOnline } = usePresence();
  const { counts } = useUnread();
  const { getPref, setPref } = useChatPrefs();
  const [showArchived, setShowArchived] = useState(false);
  const [friends, setFriends] = useState([]);
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuUp, setMenuUp] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);

  useEffect(() => {
    if (!user) return;
    loadFriends();
    loadBlocks();

    // Live updates: someone accepting your request, unfriending you,
    // or a new accepted friendship should reflect immediately.
    const channel = supabase
      .channel(`friendships-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        (payload) => {
          const row = payload.new?.id ? payload.new : payload.old;
          if (row?.requester_id === user.id || row?.addressee_id === user.id) {
            loadFriends();
          }
        }
      )
      .subscribe();

    // Safety-net poll: guarantees a friend acceptance or unfriend
    // shows up within ~15s even if Supabase realtime replication for
    // `friendships` isn't enabled.
    const poll = setInterval(loadFriends, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, user]);

  async function loadFriends() {
    if (!user) return;

    // An accepted friendship can have the current user as either
    // the original requester or the addressee who accepted it.
    const { data, error } = await supabase
      .from('friendships')
      .select(
        `
        requester_id,
        addressee_id,
        requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, status_message, last_seen_at),
        addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, status_message, last_seen_at)
      `
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (error) {
      console.error(error);
      return;
    }

    const list = data.map((row) =>
      row.requester_id === user.id ? row.addressee : row.requester
    );
    setFriends(list);
  }

  async function loadBlocks() {
    if (!user) return;
    const { data } = await supabase
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

    const ids = new Set();
    (data || []).forEach((b) => {
      ids.add(b.blocker_id === user.id ? b.blocked_id : b.blocker_id);
    });
    setBlockedIds(ids);
  }

  async function handleUnfriend(friend) {
    await supabase
      .from('friendships')
      .delete()
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${friend.id}),and(requester_id.eq.${friend.id},addressee_id.eq.${user.id})`
      );
    setOpenMenuId(null);
    loadFriends();
  }

  async function handleBlock(friend) {
    await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: friend.id });
    setOpenMenuId(null);
    loadBlocks();
  }

  async function handleUnblock(friend) {
    await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', friend.id);
    setOpenMenuId(null);
    loadBlocks();
  }

  const visibleFriends = friends.filter((f) => !blockedIds.has(f.id));
  const activeFriends = visibleFriends.filter((f) => !getPref('f', f.id).archived);
  const archivedFriends = visibleFriends.filter((f) => getPref('f', f.id).archived);

  function renderRow(f) {
    const unread = counts?.[f.id] || 0;
    const online = isOnline(f.id);
    const pref = getPref('f', f.id);
    return (
      <li
        key={f.id}
        className={`friend-row ${f.id === activeFriendId ? 'active' : ''}`}
        onClick={() => onSelectFriend(f)}
      >
        <Avatar url={f.avatar_url} name={f.username} size={34} online={online} showStatusDot />
        <div className="friend-row-text">
          <span className="friend-row-name">
            {f.username}
            {pref.muted && <span className="muted-icon" title="Muted"> 🔕</span>}
          </span>
          <span className="friend-row-sub">
            {f.status_message || (online ? 'Online' : `Last seen ${formatLastSeen(f.last_seen_at)}`)}
          </span>
        </div>
        {unread > 0 && <span className={`unread-badge${pref.muted ? ' muted' : ''}`}>{unread}</span>}
        <button
          className="friend-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            // open upwards when there isn't room below the button
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuUp(window.innerHeight - rect.bottom < 260);
            setOpenMenuId(openMenuId === f.id ? null : f.id);
          }}
          aria-label="Friend options"
        >
          ⋮
        </button>
        {openMenuId === f.id && (
          <div className={`friend-menu${menuUp ? ' up' : ''}`} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setPref('f', f.id, { muted: !pref.muted });
                setOpenMenuId(null);
              }}
            >
              {pref.muted ? 'Unmute notifications' : 'Mute notifications'}
            </button>
            <button
              onClick={() => {
                setPref('f', f.id, { archived: !pref.archived });
                setOpenMenuId(null);
              }}
            >
              {pref.archived ? 'Unarchive chat' : 'Archive chat'}
            </button>
            <button onClick={() => handleUnfriend(f)}>Unfriend</button>
            <button onClick={() => handleBlock(f)}>Block</button>
            <button
              onClick={() => {
                setReportTarget(f);
                setOpenMenuId(null);
              }}
            >
              Report
            </button>
          </div>
        )}
      </li>
    );
  }

  const archivedUnread = archivedFriends.reduce((sum, f) => sum + (counts?.[f.id] || 0), 0);

  return (
    <div className="friends-list">
      <h2>Friends</h2>
      {visibleFriends.length === 0 && <p className="dim small">No friends yet. Search above.</p>}
      <ul>{activeFriends.map(renderRow)}</ul>

      {archivedFriends.length > 0 && (
        <div className="archived-section">
          <button type="button" className="archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? '▾' : '▸'} Archived ({archivedFriends.length})
            {!showArchived && archivedUnread > 0 && <span className="unread-badge muted">{archivedUnread}</span>}
          </button>
          {showArchived && <ul>{archivedFriends.map(renderRow)}</ul>}
        </div>
      )}

      {blockedIds.size > 0 && (
        <div className="blocked-section">
          <h2>Blocked</h2>
          <ul>
            {friends
              .filter((f) => blockedIds.has(f.id))
              .map((f) => (
                <li key={f.id} className="friend-row blocked">
                  <Avatar url={f.avatar_url} name={f.username} size={34} />
                  <div className="friend-row-text">
                    <span className="friend-row-name">{f.username}</span>
                  </div>
                  <button className="unblock-btn" onClick={() => handleUnblock(f)}>
                    Unblock
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {reportTarget && (
        <ReportModal targetUser={reportTarget} onClose={() => setReportTarget(null)} />
      )}
    </div>
  );
}
