create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_jid text not null,
  title text not null check (length(trim(title)) > 0),
  notes text not null default '',
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_status_due_idx
  on public.tasks (user_jid, status, due_at);

create table if not exists public.user_preferences (
  user_jid text not null,
  preference_key text not null check (length(trim(preference_key)) > 0),
  preference_value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_jid, preference_key)
);

create table if not exists public.checkin_settings (
  user_jid text not null,
  checkin_type text not null check (checkin_type in ('morning', 'daytime', 'evening')),
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_jid, checkin_type)
);

create table if not exists public.checkin_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_jid text not null,
  checkin_type text not null check (checkin_type in ('morning', 'daytime', 'evening')),
  local_date date not null,
  status text not null check (status in ('pending', 'sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_jid, checkin_type, local_date)
);

create index if not exists checkin_deliveries_status_created_idx
  on public.checkin_deliveries (status, created_at);

alter table public.tasks enable row level security;
alter table public.user_preferences enable row level security;
alter table public.checkin_settings enable row level security;
alter table public.checkin_deliveries enable row level security;
