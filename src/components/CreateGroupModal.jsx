import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CreateGroupModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFriends() {
    const { data } = await supabase
      .from('chat_friendships')
      .select(
        `
        requester_id, addressee_id,
        requester:chat_profiles!chat_friendships_requester_id_fkey(id, username),
        addressee:chat_profiles!chat_friendships_addressee_id_fkey(id, username)
      `
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const list = (data || []).map((row) =>
      row.requester_id === user.id ? row.addressee : row.requester
    );
    setFriends(list);
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the group a name.');
      return;
    }
    if (selected.size === 0) {
      setError('Add at least one friend.');
      return;
    }
    setBusy(true);
    setError('');

    const { data: group, error: groupError } = await supabase
      .from('chat_groups')
      .insert({ name: name.trim(), created_by: user.id })
      .select()
      .single();

    if (groupError) {
      setError(groupError.message);
      setBusy(false);
      return;
    }

    const members = [user.id, ...selected].map((uid) => ({ group_id: group.id, user_id: uid }));
    const { error: memberError } = await supabase.from('chat_group_members').insert(members);

    if (memberError) {
      setError(memberError.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    onCreated(group);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New group</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleCreate} className="field-list">
          <input
            type="text"
            placeholder="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <p className="dim small">Add friends</p>
          <div className="group-member-picker">
            {friends.length === 0 && <p className="dim small">No friends to add yet.</p>}
            {friends.map((f) => (
              <label key={f.id} className="group-member-option">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                />
                {f.username}
              </label>
            ))}
          </div>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create group'}
          </button>
        </form>
      </div>
    </div>
  );
}
