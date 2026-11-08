// chat-delete-account - deletes the signed-in person's Dragon Chat data only.
// CAGED_DRAGON is a shared project: the login (auth user) is deliberately KEPT so the
// person's other Caged Dragon accounts are not affected. Removing the chat_profiles row
// cascades to every chat_* table; uploaded files are removed from the four chat buckets.
//
// Deploy: supabase functions deploy chat-delete-account   (JWT verification stays ON)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BUCKETS = ['chat-attachments', 'chat-avatars', 'chat-wallpapers', 'chat-status-media'];

async function listAll(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error || !data || data.length === 0) break;
    for (const e of data) {
      const p = `${prefix}/${e.name}`;
      if (e.id === null) out.push(...(await listAll(bucket, p)));
      else out.push(p);
    }
    if (data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const userClient = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: 'Not signed in' }, 401);

    for (const bucket of BUCKETS) {
      const files = await listAll(bucket, user.id);
      for (let i = 0; i < files.length; i += 100) {
        await admin.storage.from(bucket).remove(files.slice(i, i + 100));
      }
    }
    const { error: delErr } = await admin.from('chat_profiles').delete().eq('id', user.id);
    if (delErr) throw delErr;
    return json({ deleted: true });
  } catch (err) {
    console.error('chat-delete-account failed', err);
    return json({ error: 'Internal error' }, 500);
  }
});
