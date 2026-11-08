import { supabase } from '../supabaseClient';

// Lightweight, self-hosted error monitoring: uncaught errors from signed-in
// users are written to the `client_errors` table (view them in the Supabase
// dashboard). No third-party service is involved. Rows are auto-deleted
// after 30 days and rate-limited per user in the database.
const APP_VERSION = '5.11.0';
const seen = new Set();
let currentUserId = null;

export function setErrorReporterUser(userId) {
  currentUserId = userId || null;
}

async function report(message, stack) {
  if (!currentUserId) return;
  const key = `${message}|${(stack || '').slice(0, 120)}`;
  if (seen.has(key)) return; // don't repeat the same error in one session
  seen.add(key);
  if (seen.size > 50) return;
  try {
    await supabase.from('chat_client_errors').insert({
      user_id: currentUserId,
      message: String(message || 'Unknown error').slice(0, 1000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      url: window.location.pathname.slice(0, 500),
      user_agent: navigator.userAgent.slice(0, 300),
      app_version: APP_VERSION,
    });
  } catch {
    // Never let error reporting cause another error.
  }
}

export function installErrorReporter() {
  window.addEventListener('error', (e) => {
    report(e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    report(reason?.message || String(reason), reason?.stack);
  });
}
