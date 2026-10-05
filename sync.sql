create table if not exists profiles (
  code text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
-- No policies on purpose: only the server (service key) can read or write.
alter table profiles enable row level security;
