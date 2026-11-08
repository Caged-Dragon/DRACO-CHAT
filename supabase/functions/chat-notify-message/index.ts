// notify-message — called by a database trigger after every new message.
// It only receives a message id; recipients, sender and text are looked up
// server-side, so a caller cannot choose who gets notified or what it says.
// Each message is claimed once (push_sent_at), so replays do nothing.
//
// Deploy:  supabase functions deploy chat-notify-message --no-verify-jwt
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const vapidReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (vapidReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function describe(m: any): string {
  if (m.attachment_url) {
    const t = String(m.attachment_type ?? '');
    if (t === 'gif') return 'Sent a GIF';
    if (t.startsWith('image')) return 'Sent a photo';
    if (t.startsWith('audio') || t === 'voice') return 'Sent a voice message';
    return 'Sent an attachment';
  }
  return String(m.content ?? '').slice(0, 120);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!vapidReady) return json({ error: 'Push not configured' }, 503);

    const { type, id } = await req.json();
    if ((type !== 'dm' && type !== 'group') || typeof id !== 'string' || !UUID.test(id)) {
      return json({ error: 'Bad request' }, 400);
    }
    const table = type === 'dm' ? 'chat_messages' : 'chat_group_messages';

    // Claim the message exactly once
    const { data: msg } = await admin
      .from(table)
      .update({ push_sent_at: new Date().toISOString() })
      .eq('id', id)
      .is('push_sent_at', null)
      .select('*')
      .maybeSingle();
    if (!msg) return json({ sent: 0, reason: 'already handled or not found' });
    if (msg.deleted_at || (msg.expires_at && new Date(msg.expires_at) < new Date())) {
      return json({ sent: 0, reason: 'message not deliverable' });
    }

    const { data: sender } = await admin.from('chat_profiles').select('username').eq('id', msg.sender_id).maybeSingle();
    const senderName = sender?.username ?? 'Someone';
    const text = describe(msg);

    let recipients: string[] = [];
    let title = senderName;
    let body = text;

    if (type === 'dm') {
      const rid = msg.receiver_id as string;
      const { data: blocks } = await admin
        .from('chat_blocks').select('id')
        .or(`and(blocker_id.eq.${rid},blocked_id.eq.${msg.sender_id}),and(blocker_id.eq.${msg.sender_id},blocked_id.eq.${rid})`)
        .limit(1);
      if (blocks && blocks.length > 0) return json({ sent: 0, reason: 'blocked' });
      const { data: pref } = await admin
        .from('chat_preferences').select('muted').eq('owner_id', rid).eq('friend_id', msg.sender_id).maybeSingle();
      if (!pref?.muted) recipients = [rid];
    } else {
      const { data: group } = await admin.from('chat_groups').select('name').eq('id', msg.group_id).maybeSingle();
      const { data: members } = await admin.from('chat_group_members').select('user_id').eq('group_id', msg.group_id);
      const { data: muted } = await admin
        .from('chat_preferences').select('owner_id').eq('group_id', msg.group_id).eq('muted', true);
      const mutedSet = new Set((muted ?? []).map((r) => r.owner_id));
      const mentioned = new Set((msg.mentions ?? []) as string[]);
      recipients = (members ?? [])
        .map((r) => r.user_id as string)
        // a muted group still notifies people who were @mentioned
        .filter((uid) => uid !== msg.sender_id && (!mutedSet.has(uid) || mentioned.has(uid)));
      title = group?.name ?? 'Group';
      body = `${senderName}: ${text}`;
    }

    if (recipients.length === 0) return json({ sent: 0, reason: 'no recipients' });

    const { data: subs } = await admin
      .from('chat_push_subscriptions').select('id, endpoint, p256dh, auth_key').in('user_id', recipients);
    if (!subs || subs.length === 0) return json({ sent: 0, reason: 'no subscriptions' });

    const payload = JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 200), url: '/' });
    const results = await Promise.allSettled(
      subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload))
    );

    const dead: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected' && (r.reason?.statusCode === 404 || r.reason?.statusCode === 410)) dead.push(subs[i].id);
    });
    if (dead.length) await admin.from('chat_push_subscriptions').delete().in('id', dead);

    return json({ sent: results.filter((r) => r.status === 'fulfilled').length, total: subs.length });
  } catch (err) {
    console.error('notify-message failed', err);
    return json({ error: 'Internal error' }, 500);
  }
});
