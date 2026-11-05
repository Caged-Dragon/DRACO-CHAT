import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

// Settings section: download your data, two-step verification, and (for
// admins only) the report review screen.
export default function AccountSecurity({ onOpenAdmin }) {
  const { recheckMfa } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const [factor, setFactor] = useState(null); // the verified authenticator, if any
  const [enroll, setEnroll] = useState(null); // {id, qr, secret} while setting up
  const [code, setCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState('');

  useEffect(() => {
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
    loadFactors();
  }, []);

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactor(data?.totp?.[0] || null);
  }

  async function downloadMyData() {
    setExporting(true);
    setExportError('');
    const { data, error } = await supabase.rpc('export_my_data');
    if (error || !data) {
      setExportError(error?.message || 'Could not prepare your data.');
      setExporting(false);
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dragon-chat-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setExporting(false);
  }

  async function startEnroll() {
    setMfaBusy(true);
    setMfaMsg('');
    // clear any half-finished setup so the name isn't "already taken"
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all || []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Dragon Chat',
    });
    if (error || !data) {
      setMfaMsg(error?.message || 'Could not start setup.');
      setMfaBusy(false);
      return;
    }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode('');
    setMfaBusy(false);
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaMsg('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    if (error) {
      setMfaMsg("That code didn't work. Check the 6 digits and try again.");
      setMfaBusy(false);
      return;
    }
    setEnroll(null);
    setMfaMsg('Two-step verification is now on.');
    await loadFactors();
    await recheckMfa();
    setMfaBusy(false);
  }

  async function cancelEnroll() {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.id });
    setEnroll(null);
    setCode('');
  }

  async function turnOff() {
    if (!factor) return;
    if (!window.confirm('Turn off two-step verification? Your account will be protected by your password only.')) return;
    setMfaBusy(true);
    setMfaMsg('');
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      setMfaMsg('Could not turn it off. Sign out, sign in again with your code, then try once more.');
    } else {
      setMfaMsg('Two-step verification is off.');
      await loadFactors();
      await recheckMfa();
    }
    setMfaBusy(false);
  }

  return (
    <div className="account-security">
      <h3 className="account-security-title">Account &amp; privacy</h3>

      <div className="account-row">
        <div className="account-row-text">
          <div className="account-row-label">Two-step verification</div>
          <p className="small dim">
            {factor
              ? 'On — you enter a code from your authenticator app each time you sign in.'
              : 'Add a second step with an authenticator app (Google Authenticator, Authy, 1Password…).'}
          </p>
        </div>
        {!enroll &&
          (factor ? (
            <button type="button" className="account-btn danger" onClick={turnOff} disabled={mfaBusy}>
              Turn off
            </button>
          ) : (
            <button type="button" className="account-btn" onClick={startEnroll} disabled={mfaBusy}>
              Set up
            </button>
          ))}
      </div>

      {enroll && (
        <form className="mfa-setup" onSubmit={confirmEnroll}>
          <p className="small">
            1. Scan this code with your authenticator app (or type the key in).
            <br />
            2. Enter the 6-digit code it shows.
          </p>
          <img className="mfa-qr" src={enroll.qr} alt="QR code to add Dragon Chat to your authenticator app" />
          <code className="mfa-secret">{enroll.secret}</code>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-label="6-digit code"
          />
          <div className="account-actions">
            <button type="button" className="account-btn" onClick={cancelEnroll} disabled={mfaBusy}>
              Cancel
            </button>
            <button type="submit" className="account-btn primary" disabled={mfaBusy || code.length !== 6}>
              Turn on
            </button>
          </div>
        </form>
      )}
      {mfaMsg && <p className="small account-msg" role="status">{mfaMsg}</p>}

      <div className="account-row">
        <div className="account-row-text">
          <div className="account-row-label">Download my data</div>
          <p className="small dim">A copy of your profile, friends, messages, groups, statuses and calls (JSON file).</p>
        </div>
        <button type="button" className="account-btn" onClick={downloadMyData} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {exportError && <p className="error-text small">{exportError}</p>}

      {isAdmin && (
        <div className="account-row">
          <div className="account-row-text">
            <div className="account-row-label">Admin: review reports</div>
            <p className="small dim">See user reports, resolve or dismiss them, and suspend accounts.</p>
          </div>
          <button type="button" className="account-btn primary" onClick={onOpenAdmin}>
            Open
          </button>
        </div>
      )}
    </div>
  );
}
