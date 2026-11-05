import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

const MODES = {
  LOGIN: 'login',
  SIGNUP: 'signup',
  CHECK_EMAIL: 'check_email',
  FORGOT: 'forgot',
  FORGOT_SENT: 'forgot_sent',
};

export default function Login({ onBackToLanding }) {
  const { signIn, signUp, signInWithProvider, resendConfirmation, sendPasswordReset } = useAuth();
  const [mode, setMode] = useState(MODES.LOGIN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  // Whether the last login error was specifically "email not confirmed"
  const [unconfirmed, setUnconfirmed] = useState(false);

  function resetMessages() {
    setError('');
    setInfo('');
    setUnconfirmed(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    setBusy(true);

    if (mode === MODES.LOGIN) {
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setUnconfirmed(true);
          setError('Please confirm your email before logging in.');
        } else {
          setError(error.message);
        }
      }
    } else if (mode === MODES.SIGNUP) {
      if (!username.trim()) {
        setError('Please choose a username.');
        setBusy(false);
        return;
      }
      const { data, error } = await signUp(email, password, username.trim());
      if (error) {
        setError(error.message);
      } else if (data?.user && !data?.session) {
        // Email confirmation is required — no session yet
        setMode(MODES.CHECK_EMAIL);
      } else {
        // Email confirmation disabled in Supabase — user is signed in already
        setInfo('Account created!');
      }
    } else if (mode === MODES.FORGOT) {
      if (!email.trim()) {
        setError('Enter your email first.');
        setBusy(false);
        return;
      }
      const { error } = await sendPasswordReset(email.trim());
      if (error) {
        setError(error.message);
      } else {
        setMode(MODES.FORGOT_SENT);
      }
    }

    setBusy(false);
  }

  async function handleResend() {
    resetMessages();
    setBusy(true);
    const { error } = await resendConfirmation(email);
    if (error) setError(error.message);
    else setInfo('Confirmation email resent — check your inbox.');
    setBusy(false);
  }

  async function handleOAuth(provider) {
    resetMessages();
    const { error } = await signInWithProvider(provider);
    if (error) setError(error.message);
    // On success, Supabase redirects away — nothing else to do here.
  }

  // --- "Check your email" screen after signup ---
  if (mode === MODES.CHECK_EMAIL) {
    return (
      <div className="center-screen" role="main">
        <div className="auth-card">
          <img src="/logo.png" alt="Dragon Chat" className="auth-logo" />
          <h1>Check your email</h1>
          <p className="dim small" style={{ textAlign: 'center' }}>
            We sent a confirmation link to <strong>{email}</strong>. Click it to
            activate your account, then come back and log in.
          </p>
          {info && <p className="info-text">{info}</p>}
          {error && <p className="error-text">{error}</p>}
          <button onClick={handleResend} disabled={busy}>
            {busy ? 'Sending...' : 'Resend email'}
          </button>
          <p className="switch-mode">
            <span onClick={() => setMode(MODES.LOGIN)}>Back to log in</span>
          </p>
        </div>
        <p className="studio-credit">Built by Caged Dragon Studios</p>
      </div>
    );
  }

  // --- "Reset link sent" screen ---
  if (mode === MODES.FORGOT_SENT) {
    return (
      <div className="center-screen" role="main">
        <div className="auth-card">
          <img src="/logo.png" alt="Dragon Chat" className="auth-logo" />
          <h1>Check your email</h1>
          <p className="dim small" style={{ textAlign: 'center' }}>
            If an account exists for <strong>{email}</strong>, a password reset
            link is on its way.
          </p>
          <p className="switch-mode">
            <span onClick={() => setMode(MODES.LOGIN)}>Back to log in</span>
          </p>
        </div>
        <p className="studio-credit">Built by Caged Dragon Studios</p>
      </div>
    );
  }

  const isForgot = mode === MODES.FORGOT;
  const isSignup = mode === MODES.SIGNUP;

  return (
    <div className="center-screen" role="main">
      {onBackToLanding && (
        <span className="back-to-landing" onClick={onBackToLanding}>
          ← Home
        </span>
      )}
      <form className="auth-card" onSubmit={handleSubmit}>
        <img src="/logo.png" alt="Dragon Chat" className="auth-logo" />
        <h1>{isForgot ? 'Reset password' : isSignup ? 'Sign up' : 'Log in'}</h1>
        <p className="tagline">Connect Different. Chat Real.</p>

        {isSignup && (
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {!isForgot && (
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        )}

        {error && <p className="error-text">{error}</p>}
        {info && <p className="info-text">{info}</p>}
        {unconfirmed && (
          <button type="button" onClick={handleResend} disabled={busy}>
            Resend confirmation email
          </button>
        )}

        <button type="submit" disabled={busy}>
          {busy
            ? 'Please wait...'
            : isForgot
            ? 'Send reset link'
            : isSignup
            ? 'Sign up'
            : 'Log in'}
        </button>

        {!isForgot && (
          <>
            <div className="divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="oauth-btn github"
              onClick={() => handleOAuth('github')}
            >
              Continue with GitHub
            </button>
          </>
        )}

        <p className="switch-mode">
          {isForgot ? (
            <span onClick={() => setMode(MODES.LOGIN)}>Back to log in</span>
          ) : isSignup ? (
            <>
              Already have an account?{' '}
              <span onClick={() => setMode(MODES.LOGIN)}>Log in</span>
            </>
          ) : (
            <>
              No account?{' '}
              <span onClick={() => setMode(MODES.SIGNUP)}>Sign up</span>
              {' · '}
              <span onClick={() => setMode(MODES.FORGOT)}>Forgot password?</span>
            </>
          )}
        </p>
      </form>
      <p className="legal-links legal-consent">
        By continuing you agree to our{' '}
        <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a> and{' '}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
      </p>
      <p className="studio-credit">Built by Caged Dragon Studios</p>
    </div>
  );
}
