import ThemeToggle from '../components/ThemeToggle.jsx';
import { useState } from 'react';
import { friendlyAuthError } from '../utils/authErrors.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ResetPassword() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);

    if (error) {
      setError(friendlyAuthError(error));
    } else {
      // Sign out so the user logs back in fresh with the new password
      await signOut();
    }
  }

  return (
    <div className="center-screen">
        <ThemeToggle className="floating" />
      <form className="auth-card" onSubmit={handleSubmit}>
        <img src="/logo.png" alt="Dragon Chat" className="auth-logo" />
        <h1>Set a new password</h1>

        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={6}
          required
        />

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Updating...' : 'Update password'}
        </button>
      </form>
      <p className="studio-credit">Built by Caged Dragon Studios</p>
    </div>
  );
}
