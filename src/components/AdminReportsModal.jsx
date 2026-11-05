import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const TABS = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['dismissed', 'Dismissed'],
  ['all', 'All'],
];

function ReportCard({ report, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOpen = report.status === 'open';

  async function review(status, suspend = null) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('admin_review_report', {
      p_report_id: report.id,
      p_status: status,
      p_note: note,
      p_suspend: suspend,
    });
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  }

  return (
    <div className="admin-report">
      <div className="admin-report-head">
        <strong>{report.reporter_username}</strong> reported <strong>{report.reported_username}</strong>
        {report.reported_suspended && <span className="admin-pill danger">Suspended</span>}
        {!isOpen && <span className="admin-pill">{report.status}</span>}
      </div>
      <div className="small dim">
        {new Date(report.created_at).toLocaleString()} · {report.reports_against_total} report
        {Number(report.reports_against_total) === 1 ? '' : 's'} against this user in total
      </div>
      <p className="admin-reason">“{report.reason}”</p>
      {(report.message_content || report.message_attachment) && (
        <blockquote className="admin-message">
          Reported message{report.message_created_at ? ` (${new Date(report.message_created_at).toLocaleString()})` : ''}:
          <br />
          {report.message_content || `[${report.message_attachment}]`}
        </blockquote>
      )}
      {report.admin_note && <p className="small admin-note-saved">Note: {report.admin_note}</p>}

      {isOpen && (
        <>
          <textarea
            className="admin-note"
            placeholder="Optional note (only admins see this)"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Admin note"
          />
          <div className="admin-actions">
            <button type="button" className="account-btn" disabled={busy} onClick={() => review('dismissed')}>
              Dismiss
            </button>
            <button type="button" className="account-btn" disabled={busy} onClick={() => review('resolved')}>
              Resolve
            </button>
            {report.reported_suspended ? (
              <button type="button" className="account-btn" disabled={busy} onClick={() => review('resolved', false)}>
                Resolve + unsuspend
              </button>
            ) : (
              <button type="button" className="account-btn danger" disabled={busy} onClick={() => review('resolved', true)}>
                Resolve + suspend user
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

export default function AdminReportsModal({ onClose }) {
  const [tab, setTab] = useState('open');
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');

  async function load(status = tab) {
    setReports(null);
    setError('');
    const { data, error: err } = await supabase.rpc('admin_list_reports', { p_status: status, p_limit: 100 });
    if (err) {
      setError(err.message);
      setReports([]);
    } else {
      setReports(data || []);
    }
  }

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Review reports</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="admin-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`admin-tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="error-text small">{error}</p>}
        {reports === null && <p className="dim small">Loading…</p>}
        {reports && reports.length === 0 && !error && <p className="dim small">Nothing here.</p>}
        <div className="admin-list">
          {(reports || []).map((r) => (
            <ReportCard key={r.id} report={r} onDone={() => load(tab)} />
          ))}
        </div>
      </div>
    </div>
  );
}
