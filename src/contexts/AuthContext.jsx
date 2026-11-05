import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { setErrorReporterUser } from '../utils/errorReporter.js';
import { clearOutbox } from '../utils/outbox.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // True while the user is in the middle of a "reset your password" link flow
  const [recoveryMode, setRecoveryMode] = useState(false);
  // Two-step verification: which user we last checked, and whether a code is still needed
  const [mfa, setMfa] = useState({ uid: null, required: false });

  useEffect(() => {
    // Load existing session (if the user already logged in before)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Keep session in sync (login, logout, token refresh, password recovery)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, status_message, presence_status, last_seen_at, user_number, created_at')
      .eq('id', userId)
      .single();
    setProfile(data);
    return data;
  }

  // Whenever we have a logged-in user, load (or create) their profile row.
  // OAuth sign-ins land here too, since the DB trigger creates a profile
  // for every new auth.users row regardless of how they signed up.
  useEffect(() => {
    setErrorReporterUser(session?.user?.id);
    if (!session?.user) {
      setProfile(null);
      return;
    }
    // Defer so we never call auth methods inside the auth-state callback itself
    const uid = session.user.id;
    const t = setTimeout(() => checkMfa(uid), 0);
    loadProfile(uid);
    return () => clearTimeout(t);
  }, [session]);

  // Re-fetch the current user's profile row — used after updating the
  // avatar, status message, or presence status so the change shows up
  // immediately everywhere the profile is used.
  async function refreshProfile() {
    if (!session?.user) return null;
    return loadProfile(session.user.id);
  }

  async function signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    return { data, error };
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signInWithProvider(provider) {
    // provider: 'google' | 'github'
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    return { data, error };
  }

  async function resendConfirmation(email) {
    const { data, error } = await supabase.auth.resend({ type: 'signup', email });
    return { data, error };
  }

  async function sendPasswordReset(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { data, error };
  }

  async function updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) setRecoveryMode(false);
    return { data, error };
  }

  async function signOut() {
    // unsent queued messages shouldn't stay on a shared device after logout
    if (session?.user) clearOutbox(session.user.id);
    await supabase.auth.signOut();
  }

  // Does this session still need the second step? (only if the account has it turned on)
  async function checkMfa(uid) {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const required = !error && !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
    setMfa({ uid, required });
  }

  async function recheckMfa() {
    if (session?.user) await checkMfa(session.user.id);
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    recoveryMode,
    signUp,
    signIn,
    signInWithProvider,
    resendConfirmation,
    sendPasswordReset,
    updatePassword,
    signOut,
    refreshProfile,
    recheckMfa,
    // true until we know whether this login still needs a two-step code
    mfaChecking: !!session?.user && mfa.uid !== session.user.id,
    mfaRequired: !!session?.user && mfa.uid === session.user.id && mfa.required,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
