import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ReportModal({ targetUser, onClose }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please describe the issue.');
      return;
    }
    setBusy(true);
    setError('');

    const { error } = await supabase.from('chat_reports').insert({
      reporter_id: user.id,
      reported_id: targetUser.id,
      reason: reason.trim(),
    });

    if (error) setError(error.message);
    else setSubmitted(true);
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Report {targetUser.username}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {submitted ? (
          <p className="info-text">Thanks — your report has been filed.</p>
        ) : (
          <form onSubmit={handleSubmit} className="field-list">
            <textarea
              className="report-textarea"
              placeholder="What happened?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
            {error && <p className="error-text">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? 'Submitting...' : 'Submit report'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
