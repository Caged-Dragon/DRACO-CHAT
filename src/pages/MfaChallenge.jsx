import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';

// Shown after the password step when the account has two-step verification.
export default function MfaChallenge() {
  const { signOut, recheckMfa } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.[0];
    if (!factor) {
      setError('No authenticator is set up on this account.');
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError("That code didn't work. Check the 6 digits and try again.");
      setBusy(false);
      return;
    }
    await recheckMfa();
    setBusy(false);
  }

  return (
    <div className="center-screen" role="main">
      <form className="auth-card" onSubmit={submit}>
        <h1>Two-step verification</h1>
        <p className="dim small">Enter the 6-digit code from your authenticator app.</p>
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
          autoFocus
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="primary-btn" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Verify'}
        </button>
        <button type="button" className="link-btn" onClick={signOut}>
          Sign out
        </button>
      </form>
    </div>
  );
}
