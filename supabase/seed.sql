-- Shared, non-sensitive development data belongs in this file.
-- It is applied after all migrations by `npm run supabase:reset`.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'eleanor.hughes@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Eleanor Hughes"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'marcus.patel@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Marcus Patel"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'priya.shah@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Priya Shah"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'daniel.brooks@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Daniel Brooks"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'amelia.clarke@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Amelia Clarke"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'john.smith@example.test',
    extensions.crypt('local-only-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"John Smith"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id,
  account_type,
  member_role,
  is_admin,
  display_name,
  email,
  account_status
)
values
  ('10000000-0000-4000-8000-000000000001', 'MEMBER', 'OFFICER', true, 'Eleanor Hughes', 'eleanor.hughes@example.test', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000002', 'MEMBER', 'OFFICER', false, 'Marcus Patel', 'marcus.patel@example.test', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000003', 'MEMBER', 'USER', false, 'Priya Shah', 'priya.shah@example.test', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000004', 'MEMBER', 'USER', false, 'Daniel Brooks', 'daniel.brooks@example.test', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000005', 'MEMBER', 'USER', false, 'Amelia Clarke', 'amelia.clarke@example.test', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000006', 'MEMBER', 'TREASURER', false, 'John Smith', 'john.smith@example.test', 'ACTIVE')
on conflict (id) do update set
  account_type = excluded.account_type,
  member_role = excluded.member_role,
  is_admin = excluded.is_admin,
  display_name = excluded.display_name,
  email = excluded.email,
  account_status = excluded.account_status;
