// Offline message queue ("outbox").
//
// Every text/GIF/attachment message is written here first, then sent. If the
// network is down the message stays queued (and is shown in the chat as
// "Sending…"), and it is delivered automatically when the connection returns.
// Messages get their id on the device, so a retry after a flaky network can
// never create a duplicate.

const keyFor = (uid) => `dragonchat.outbox.${uid}`;
const listeners = new Set();
let flushing = false;

// Messages queued while offline by an older version of the app still carry the old
// table names; map them so they are delivered instead of failing forever.
const LEGACY_TABLES = { messages: 'chat_messages', group_messages: 'chat_group_messages' };

function read(uid) {
  try {
    const items = JSON.parse(localStorage.getItem(keyFor(uid)) || '[]');
    return Array.isArray(items)
      ? items.map((i) => (LEGACY_TABLES[i?.table] ? { ...i, table: LEGACY_TABLES[i.table] } : i))
      : [];
  } catch {
    return [];
  }
}

function write(uid, items) {
  try {
    if (items.length) localStorage.setItem(keyFor(uid), JSON.stringify(items));
    else localStorage.removeItem(keyFor(uid));
  } catch {
    // storage full or blocked — queue stays in memory only for this call
  }
  listeners.forEach((fn) => fn());
}

export function getOutbox(uid) {
  return uid ? read(uid) : [];
}

export function subscribeOutbox(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearOutbox(uid) {
  if (uid) write(uid, []);
}

export function enqueue(uid, item) {
  write(uid, [...read(uid), item]);
}

export function discardOutboxItem(uid, id) {
  write(uid, read(uid).filter((i) => i.id !== id));
}

export function retryOutboxItem(uid, id) {
  write(
    uid,
    read(uid).map((i) => (i.id === id ? { ...i, failed: null } : i))
  );
}

export function isNetworkError(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(error.message || '');
}

// Plain-language reasons for messages that can never be delivered
export function friendlyError(error) {
  const msg = error?.message || '';
  if (/row-level security|violates/i.test(msg)) {
    return "You can't send messages in this chat right now.";
  }
  if (/too fast/i.test(msg)) return 'You are sending messages too fast. Please slow down.';
  return msg || 'Could not send.';
}

// Try to deliver everything that's queued, oldest first.
export async function flushOutbox(supabase, uid) {
  if (!uid || flushing) return;
  flushing = true;
  try {
    for (;;) {
      const next = read(uid).find((i) => !i.failed);
      if (!next) break;
      const { error } = await supabase.from(next.table).insert(next.row);

      if (!error || error.code === '23505') {
        // sent (or it had already gone through on an earlier try)
        discardOutboxItem(uid, next.id);
      } else if (isNetworkError(error)) {
        break; // still offline — keep everything queued and try again later
      } else if (/too fast/i.test(error.message || '')) {
        break; // rate limited — try again on the next tick
      } else {
        write(
          uid,
          read(uid).map((i) => (i.id === next.id ? { ...i, failed: friendlyError(error) } : i))
        );
      }
    }
  } finally {
    flushing = false;
  }
}

// Queue a message and send it right away if possible.
export function sendViaOutbox(supabase, uid, table, row, preview) {
  const id = row.id || crypto.randomUUID();
  enqueue(uid, {
    id,
    table,
    row: { ...row, id },
    preview: preview || 'Message',
    createdAt: Date.now(),
    failed: null,
  });
  return flushOutbox(supabase, uid);
}
