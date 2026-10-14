-- Friends ("who is free right now"). Run once in the Supabase SQL editor.
create table if not exists fprofiles (
  fid text primary key,              -- public friend code, 8 characters
  secret_hash text not null,         -- sha-256 of the secret that stays on the device
  name text not null default '',
  ghost boolean not null default false,
  hide boolean not null default false,
  snap jsonb not null default '{}',  -- the next 7 days of lessons, nothing else
  updated_at timestamptz not null default now()
);
create table if not exists fships (
  lo text not null,
  hi text not null,
  requester text not null,
  state text not null check (state in ('pending','accepted','blocked')),
  blocker text,
  updated_at timestamptz not null default now(),
  primary key (lo, hi)
);
create index if not exists fships_hi on fships (hi);
-- No policies on purpose: only the server (service key) can read or write.
alter table fprofiles enable row level security;
alter table fships enable row level security;
