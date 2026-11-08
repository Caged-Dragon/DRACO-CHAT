import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useCall } from '../contexts/CallContext.jsx';
import Avatar from './Avatar.jsx';
import { formatLastSeen } from '../utils/format.js';

const STATUS_ICON = { completed: '✅', missed: '❌', declined: '🚫' };

export default function CallHistoryModal({ onClose }) {
  const { user } = useAuth();
  const { startCall, callState } = useCall();
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from('chat_calls')
      .select(
        `
        id, call_type, status, duration_seconds, created_at, caller_id, callee_id,
        caller:chat_profiles!chat_calls_caller_id_fkey(id, username, avatar_url),
        callee:chat_profiles!chat_calls_callee_id_fkey(id, username, avatar_url)
      `
      )
      .order('created_at', { ascending: false })
      .limit(50);

    setCalls(data || []);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Call history</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {calls.length === 0 && <p className="dim small">No calls yet.</p>}

        <ul className="call-history-list">
          {calls.map((c) => {
            const iWasCaller = c.caller_id === user.id;
            const other = iWasCaller ? c.callee : c.caller;
            const mins = Math.floor(c.duration_seconds / 60);
            const secs = c.duration_seconds % 60;
            return (
              <li key={c.id} className="call-history-row">
                <Avatar url={other?.avatar_url} name={other?.username} size={34} />
                <div className="call-history-info">
                  <span className="call-history-name">{other?.username}</span>
                  <span className="call-history-sub">
                    {STATUS_ICON[c.status]} {c.call_type === 'video' ? 'Video' : 'Voice'}
                    {c.status === 'completed' && ` · ${mins}:${String(secs).padStart(2, '0')}`}
                    {' · '}
                    {formatLastSeen(c.created_at)}
                  </span>
                </div>
                <button
                  className="call-back-btn"
                  onClick={() => {
                    onClose();
                    startCall(other, c.call_type);
                  }}
                  disabled={callState !== 'idle'}
                  aria-label={`Call ${other?.username}`}
                >
                  📞
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
