import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

const DEBOUNCE_MS = 300;

export default function SearchFriends({ onRequestSent }) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function runSearch(term) {
    // Guards against an older, slower request overwriting a newer one
    const thisRequestId = ++requestIdRef.current;

    const { data, error } = await supabase
      .from('chat_profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${term}%`)
      .neq('id', user.id)
      .limit(10);

    if (thisRequestId !== requestIdRef.current) return; // a newer keystroke already fired

    setSearching(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setResults(data);
  }

  async function sendRequest(addresseeId) {
    setMessage('');
    const { error } = await supabase.from('chat_friendships').insert([
      { requester_id: user.id, addressee_id: addresseeId },
    ]);

    if (error) {
      if (error.code === '23505') {
        setMessage('Request already sent (or you\u2019re already friends).');
      } else {
        setMessage(error.message);
      }
      return;
    }

    setMessage('Friend request sent!');
    setResults((prev) => prev.filter((r) => r.id !== addresseeId));
    onRequestSent?.();
  }

  return (
    <div className="search-friends">
      <input
        type="text"
        placeholder="Search by username"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMessage('');
        }}
      />

      {searching && <p className="dim small">Searching...</p>}
      {message && <p className="info-text small">{message}</p>}

      {!searching && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              <span>{r.username}</span>
              <button onClick={() => sendRequest(r.id)}>Add</button>
            </li>
          ))}
        </ul>
      )}

      {!searching && query.trim() && results.length === 0 && !message && (
        <p className="dim small">No matching users.</p>
      )}
    </div>
  );
}
