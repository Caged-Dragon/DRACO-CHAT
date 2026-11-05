-- Dragon Chat — admin / suspension / two-step-verification database test.
-- Run in the Supabase SQL Editor (needs at least 3 rows in public.profiles).
-- Everything happens inside a transaction that is rolled back (the report is the error message).
do $$
declare a uuid; b uuid; c uuid; rid uuid; res text := ''; n int; j jsonb; r record;
begin
  select id into a from public.profiles order by created_at limit 1;
  select id into b from public.profiles where id <> a order by created_at limit 1;
  select id into c from public.profiles where id not in (a, b) order by created_at limit 1;
  if c is null then raise exception 'need 3 profiles'; end if;
  update public.profiles set is_admin = true where id = a;        -- a = admin (rolled back)

  -- b = normal user who reports c
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal1', 'email', 'x@test.dev')::text, true);
  set local role authenticated;
  begin update public.profiles set is_admin = true where id = b; res := res || 'FAIL self-promote; ';
  exception when insufficient_privilege then res := res || 'ok cannot self-promote; '; end;
  begin perform is_admin from public.profiles limit 1; res := res || 'FAIL is_admin readable; ';
  exception when insufficient_privilege then res := res || 'ok is_admin hidden; '; end;
  begin perform * from public.admin_list_reports(); res := res || 'FAIL non-admin list; ';
  exception when insufficient_privilege then res := res || 'ok non-admin list blocked; '; end;
  insert into public.reports(reporter_id, reported_id, reason) values (b, c, 'spam test') returning id into rid;
  j := public.export_my_data();
  res := res || case when j #>> '{account,email}' = 'x@test.dev' then 'ok export; ' else 'FAIL export; ' end;

  -- a = admin reviews + suspends c
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.admin_list_reports('open') where id = rid; res := res || 'admin sees open=' || n || '; ';
  perform public.admin_review_report(rid, 'resolved', 'warned user', true);
  select reported_suspended into r from public.admin_list_reports('all') where id = rid;
  res := res || case when r.reported_suspended then 'ok suspended; ' else 'FAIL not suspended; ' end;

  -- c (suspended) cannot post, can still read
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  begin insert into public.statuses(user_id, content_type, text_content) values (c, 'text', 'hi'); res := res || 'FAIL suspended posted; ';
  exception when others then res := res || 'ok suspended cannot post; '; end;

  -- two-step verification: a turns it on
  reset role;
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
    values (gen_random_uuid(), a, 'totp', 'verified', now(), now(), 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles; res := res || 'enrolled@aal1 sees ' || n || ' rows; ';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles; res := res || 'enrolled@aal2 sees ' || n || ' rows; ';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles; res := res || 'not-enrolled@aal1 sees ' || n || ' rows; ';

  raise exception 'ADMIN/MFA TEST REPORT: %', res;
end $$;
