create table if not exists subscribers (
  id bigint generated always as identity primary key,
  endpoint text unique not null,
  subscription jsonb not null,
  cls text,
  mine jsonb default '[]',
  cfg jsonb default '{}',
  tasks jsonb default '[]',
  fired jsonb default '{}',
  inited boolean default false,
  updated_at timestamptz default now()
);
-- No policies on purpose: only the server (service key) can read or write.
alter table subscribers enable row level security;

create table if not exists profiles (
  code text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
-- No policies on purpose: only the server (service key) can read or write.
alter table profiles enable row level security;
