import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function FriendRequests({ refreshKey, onChange }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    if (!user) return;
    loadRequests();

    // Live updates: a new incoming request (or someone withdrawing
    // one) should show up immediately, not just after a reload.
    const channel = supabase
      .channel(`friend-requests-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        (payload) => {
          const row = payload.new?.id ? payload.new : payload.old;
          if (row?.addressee_id === user.id) loadRequests();
        }
      )
      .subscribe();

    // Safety-net poll: guarantees requests show up within ~15s even if
    // Supabase realtime replication for `friendships` isn't enabled.
    const poll = setInterval(loadRequests, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, user]);

  async function loadRequests() {
    if (!user) return;

    const { data, error } = await supabase
      .from('friendships')
      .select('id, requester:profiles!friendships_requester_id_fkey(id, username)')
      .eq('addressee_id', user.id)
      .eq('status', 'pending');

    if (error) {
      console.error(error);
      return;
    }
    setRequests(data);
  }

  async function accept(id) {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', id);
    if (error) {
      console.error(error);
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
    onChange?.();
  }

  async function decline(id) {
    const { error } = await supabase.from('friendships').delete().eq('id', id);
    if (error) {
      console.error(error);
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
    onChange?.();
  }

  if (requests.length === 0) return null;

  return (
    <div className="friend-requests">
      <h2>Friend requests</h2>
      <ul>
        {requests.map((r) => (
          <li key={r.id}>
            <span>{r.requester.username}</span>
            <div className="request-actions">
              <button className="accept-btn" onClick={() => accept(r.id)}>
                Accept
              </button>
              <button className="decline-btn" onClick={() => decline(r.id)}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
