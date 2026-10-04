-- Demo accounts: one confirmed, approved sign-in per role, each linked to a seeded person.
-- Run with the password substituted for :demo_password (never commit the real value).
-- Used by the "Demo sign-in" panel, which only shows when ENABLE_DEMO=1.
-- The Dashboard Lead / System Administrator person (Jibin K K) is not here: that person is a
-- real account, and a person can be linked to only one account.
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v record;
  uid uuid;
begin
  for v in
    select * from (values
      ('project-head',   'Shon J Iype'),
      ('project-lead',   'Shon Domnic'),
      ('production-lead-pavithra', 'Pavithra'),
      ('production-lead-rustham',  'Rustham'),
      ('reviewer',       'Fayis'),
      ('supporting',     'Mohammed Ali'),
      ('team-member',    'Rijin')
    ) t(slug, person)
  loop
    if exists (select 1 from auth.users where email = 'demo+' || v.slug || '@audit360.demo') then
      continue;
    end if;
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'demo+' || v.slug || '@audit360.demo',
      extensions.crypt(:'demo_password', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v.person || ' (demo)'),
      now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
      jsonb_build_object('sub', uid::text, 'email', 'demo+' || v.slug || '@audit360.demo', 'email_verified', true),
      now(), now(), now());
    update public.profiles
       set approval_state = 'approved',
           person_id = (select id from public.people where display_name = v.person)
     where id = uid;
  end loop;
end $$;
