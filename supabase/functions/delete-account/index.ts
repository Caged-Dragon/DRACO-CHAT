// !!! SHARED PROJECT WARNING !!!
// This project (CAGED_DRAGON) is shared with other Caged Dragon apps. This function
// calls auth.admin.deleteUser(), which removes the person's login for EVERY app on the
// project, not just Dragon Chat. Do not deploy it until it is changed to delete only
// Dragon Chat data (files + public.profiles row) and keep the auth user.
//
// delete-account — lets a signed-in user permanently delete their own account.
// Removes every file they uploaded, then deletes the auth user; database rows
// (profile, messages, friendships, ...) are removed by ON DELETE CASCADE.
//
// Deploy: supabase functions deploy delete-account   (JWT verification stays ON)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUCKETS = ['chat-attachments', 'avatars', 'chat-wallpapers', 'status-media'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function listAll(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const out: string[] = [];
  for (const item of data) {
    const full = `${prefix}/${item.name}`;
    if (item.id === null) out.push(...(await listAll(bucket, full, depth + 1)));
    else out.push(full);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== 'DELETE') return json({ error: 'Confirmation text missing' }, 400);

    for (const bucket of BUCKETS) {
      const paths = await listAll(bucket, uid);
      for (let i = 0; i < paths.length; i += 100) {
        await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw delErr;
    return json({ deleted: true });
  } catch (err) {
    console.error('delete-account failed', err);
    return json({ error: 'Could not delete the account. Please try again or contact support.' }, 500);
  }
});
