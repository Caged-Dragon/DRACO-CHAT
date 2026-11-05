// In-memory stand-in for Supabase Realtime broadcast channels, used only by
// the end-to-end call test. Messages go to every OTHER channel object with
// the same name (like real Supabase, a client never hears its own broadcasts).
const channels = new Set();
window.__signals = [];
window.__calls = [];

function notifyPresence(name, event, extra) {
  setTimeout(() => {
    channels.forEach((c) => {
      if (c.name === name && c.subscribed) c._deliverPresence(event, extra);
    });
  }, 10);
}

function makeChannel(name, opts) {
  const handlers = [];
  const ch = {
    name,
    key: opts?.config?.presence?.key,
    tracked: false,
    meta: null,
    subscribed: false,
    on(type, filter, cb) {
      handlers.push({ type, event: filter?.event, cb });
      return ch;
    },
    subscribe(cb) {
      channels.add(ch);
      setTimeout(() => {
        ch.subscribed = true;
        cb && cb('SUBSCRIBED');
      }, 5);
      return ch;
    },
    send({ type, event, payload }) {
      window.__signals.push({ channel: name, event });
      const msg = JSON.parse(JSON.stringify({ event, payload }));
      setTimeout(() => {
        channels.forEach((other) => {
          if (other === ch || other.name !== name || !other.subscribed) return;
          other._deliver(type, msg);
        });
      }, 8);
      return Promise.resolve('ok');
    },
    _deliver(type, msg) {
      handlers.forEach((h) => {
        if (h.type === type && h.event === msg.event) h.cb({ payload: msg.payload });
      });
    },
    _deliverPresence(event, extra) {
      handlers.forEach((h) => {
        if (h.type === 'presence' && h.event === event) h.cb(extra || {});
      });
    },
    track: async (meta) => {
      ch.tracked = true;
      ch.meta = meta;
      notifyPresence(name, 'sync');
      return 'ok';
    },
    presenceState: () => {
      const state = {};
      channels.forEach((c) => {
        if (c.name === name && c.tracked) state[c.key] = [c.meta];
      });
      return state;
    },
  };
  return ch;
}

export const supabase = {
  channel: (name, opts) => makeChannel(name, opts),
  removeChannel: (ch) => {
    const wasTracked = ch.tracked;
    channels.delete(ch);
    if (wasTracked) {
      notifyPresence(ch.name, 'leave', { key: ch.key });
      notifyPresence(ch.name, 'sync');
    }
  },
  from: (table) => ({
    insert: async (row) => {
      if (table === 'calls') window.__calls.push(row);
      return { error: null };
    },
  }),
};
