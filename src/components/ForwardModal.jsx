import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ForwardModal({ message, onClose }) {
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTargets() {
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

    setFriends(
      (friendRows || []).map((row) => (row.requester_id === user.id ? row.addressee : row.requester))
    );

    const { data: groupRows } = await supabase
      .from('chat_group_members')
      .select('groups:chat_groups(id, name)')
      .eq('user_id', user.id);
    setGroups((groupRows || []).map((r) => r.groups).filter(Boolean));
  }

  async function forwardToFriend(friendId) {
    setBusy(true);
    setError('');
    const { error } = await supabase.from('chat_messages').insert({
      sender_id: user.id,
      receiver_id: friendId,
      content: message.content || null,
      attachment_url: message.attachment_url || null,
      attachment_type: message.attachment_type || null,
      attachment_name: message.attachment_name || null,
    });
    if (error) setError(error.message);
    else setSentTo((prev) => new Set(prev).add(`friend-${friendId}`));
    setBusy(false);
  }

  async function forwardToGroup(groupId) {
    setBusy(true);
    setError('');
    const { error } = await supabase.from('chat_group_messages').insert({
      group_id: groupId,
      sender_id: user.id,
      content: message.content || null,
      attachment_url: message.attachment_url || null,
      attachment_type: message.attachment_type || null,
      attachment_name: message.attachment_name || null,
    });
    if (error) setError(error.message);
    else setSentTo((prev) => new Set(prev).add(`group-${groupId}`));
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Forward message</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="dim small">{message.content || message.attachment_name || 'Attachment'}</p>

        <div className="forward-list">
          {friends.map((f) => (
            <div key={f.id} className="forward-row">
              <span>{f.username}</span>
              <button
                onClick={() => forwardToFriend(f.id)}
                disabled={busy || sentTo.has(`friend-${f.id}`)}
              >
                {sentTo.has(`friend-${f.id}`) ? 'Sent ✓' : 'Send'}
              </button>
            </div>
          ))}
          {groups.map((g) => (
            <div key={g.id} className="forward-row">
              <span>👥 {g.name}</span>
              <button
                onClick={() => forwardToGroup(g.id)}
                disabled={busy || sentTo.has(`group-${g.id}`)}
              >
                {sentTo.has(`group-${g.id}`) ? 'Sent ✓' : 'Send'}
              </button>
            </div>
          ))}
          {friends.length === 0 && groups.length === 0 && (
            <p className="dim small">No friends or groups to forward to yet.</p>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-footer">
          <span />
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
