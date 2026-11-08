// cleanup-storage — deletes uploaded files whose message/status/avatar row was removed.
// Triggered every 10 minutes by pg_cron. It only ever processes paths that the
// database itself queued, so calling it with no auth is harmless.
//
// Deploy: supabase functions deploy chat-cleanup-storage --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ALLOWED = new Set(['chat-attachments', 'chat-avatars', 'chat-wallpapers', 'chat-status-media']);

function safeDecode(p: string) {
  try { return decodeURIComponent(p); } catch { return p; }
}

Deno.serve(async () => {
  try {
    const { data: rows, error } = await admin
      .from('chat_storage_cleanup_queue').select('id, bucket, path').order('id').limit(200);
    if (error) throw error;
    if (!rows || rows.length === 0) return new Response(JSON.stringify({ removed: 0 }));

    const byBucket = new Map<string, { ids: number[]; paths: string[] }>();
    const skipIds: number[] = [];
    for (const r of rows) {
      if (!ALLOWED.has(r.bucket)) { skipIds.push(r.id); continue; }
      const entry = byBucket.get(r.bucket) ?? { ids: [], paths: [] };
      entry.ids.push(r.id);
      entry.paths.push(safeDecode(r.path));
      byBucket.set(r.bucket, entry);
    }

    let removed = 0;
    for (const [bucket, { ids, paths }] of byBucket) {
      const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
      if (rmErr) { console.error('remove failed', bucket, rmErr.message); continue; }
      await admin.from('chat_storage_cleanup_queue').delete().in('id', ids);
      removed += ids.length;
    }
    if (skipIds.length) await admin.from('chat_storage_cleanup_queue').delete().in('id', skipIds);

    return new Response(JSON.stringify({ removed }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('cleanup-storage failed', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
