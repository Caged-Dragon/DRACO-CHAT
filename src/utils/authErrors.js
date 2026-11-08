// Turns raw Supabase Auth errors into plain language. Lockout messages written by the
// database ("Too many wrong passwords...", "...locked...") are already clear - pass them through.
export function friendlyAuthError(error) {
  const message = String(error?.message || error || '').trim();
  const code = String(error?.code || '').toLowerCase();
  const lower = message.toLowerCase();

  if (code === 'over_email_send_rate_limit' || lower.includes('email rate limit')) {
    return "We can't send another email right now. Please wait a few minutes and try again.";
  }
  if (code === 'over_request_rate_limit' || lower.includes('rate limit') || error?.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (lower.includes('invalid login credentials')) {
    return 'Wrong email or password.';
  }
  return message || 'Something went wrong. Please try again.';
}
