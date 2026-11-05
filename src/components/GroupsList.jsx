import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useUnread } from '../contexts/UnreadContext.jsx';
import { useChatPrefs } from '../contexts/ChatPrefsContext.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';

export default function GroupsList({ activeGroupId, onSelectGroup, refreshKey }) {
  const { user } = useAuth();
  const { groupCounts, markGroupRead } = useUnread();
  const { getPref, setPref } = useChatPrefs();
  const [groups, setGroups] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuUp, setMenuUp] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    loadGroups();

    // Live updates: someone adding you to a new group should show up
    // immediately, not just after a reload.
    const channel = supabase
      .channel(`group-members-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members' },
        (payload) => {
          const row = payload.new?.user_id ? payload.new : payload.old;
          if (row?.user_id === user.id) loadGroups();
        }
      )
      .subscribe();

    // Safety-net poll: guarantees being added to a group shows up
    // within ~15s even if realtime replication isn't enabled.
    const poll = setInterval(loadGroups, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshKey]);

  async function loadGroups() {
    if (!user) return;
    const { data } = await supabase
      .from('group_members')
      .select('groups(id, name, avatar_url, created_by)')
      .eq('user_id', user.id);

    setGroups((data || []).map((row) => row.groups).filter(Boolean));
  }

  function openGroup(g) {
    markGroupRead(g.id);
    onSelectGroup(g);
  }

  const activeGroups = groups.filter((g) => !getPref('g', g.id).archived);
  const archivedGroups = groups.filter((g) => getPref('g', g.id).archived);
  const archivedUnread = archivedGroups.reduce((sum, g) => sum + (groupCounts?.[g.id] || 0), 0);

  function renderRow(g) {
    const unread = groupCounts?.[g.id] || 0;
    const pref = getPref('g', g.id);
    return (
      <li
        key={g.id}
        className={`group-row ${g.id === activeGroupId ? 'active' : ''}`}
        onClick={() => openGroup(g)}
      >
        <span className="group-row-name">
          👥 {g.name}
          {pref.muted && <span className="muted-icon" title="Muted"> 🔕</span>}
        </span>
        {unread > 0 && <span className={`unread-badge${pref.muted ? ' muted' : ''}`}>{unread}</span>}
        <button
          className="friend-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            // open upwards when there isn't room below the button
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuUp(window.innerHeight - rect.bottom < 260);
            setOpenMenuId(openMenuId === g.id ? null : g.id);
          }}
          aria-label="Group options"
        >
          ⋮
        </button>
        {openMenuId === g.id && (
          <div className={`friend-menu${menuUp ? ' up' : ''}`} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setPref('g', g.id, { muted: !pref.muted });
                setOpenMenuId(null);
              }}
            >
              {pref.muted ? 'Unmute notifications' : 'Mute notifications'}
            </button>
            <button
              onClick={() => {
                setPref('g', g.id, { archived: !pref.archived });
                setOpenMenuId(null);
              }}
            >
              {pref.archived ? 'Unarchive group' : 'Archive group'}
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="friends-list">
      <div className="groups-list-header">
        <h2>Groups</h2>
        <button className="create-group-btn" onClick={() => setShowCreate(true)} aria-label="New group">
          +
        </button>
      </div>
      {groups.length === 0 && <p className="dim small">No groups yet.</p>}
      <ul>{activeGroups.map(renderRow)}</ul>

      {archivedGroups.length > 0 && (
        <div className="archived-section">
          <button type="button" className="archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? '▾' : '▸'} Archived ({archivedGroups.length})
            {!showArchived && archivedUnread > 0 && <span className="unread-badge muted">{archivedUnread}</span>}
          </button>
          {showArchived && <ul>{archivedGroups.map(renderRow)}</ul>}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreated={(group) => {
            setShowCreate(false);
            loadGroups();
            onSelectGroup(group);
          }}
        />
      )}
    </div>
  );
}
