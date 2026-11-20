create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_jid text not null,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'reminder' check (kind in ('reminder', 'alarm')),
  remind_at timestamptz not null,
  timezone text not null default 'Africa/Lagos',
  recurrence text not null default 'once' check (recurrence in ('once', 'daily', 'weekly')),
  local_time text check (local_time is null or local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'cancelled')),
  sent_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((recurrence = 'once' and local_time is null) or (recurrence <> 'once' and local_time is not null))
);

create index if not exists reminders_due_idx
  on public.reminders (status, remind_at);

create index if not exists reminders_user_status_due_idx
  on public.reminders (user_jid, status, remind_at);

create table if not exists public.user_profiles (
  user_jid text primary key,
  onboarding_status text not null default 'pending' check (onboarding_status in ('pending', 'in_progress', 'completed', 'skipped')),
  onboarding_step integer not null default 0 check (onboarding_step between 0 and 2),
  pending_onboarding_step integer check (pending_onboarding_step between 0 and 2),
  pending_onboarding_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((pending_onboarding_step is null) = (pending_onboarding_answer is null))
);

create table if not exists public.profile_memories (
  user_jid text not null,
  memory_key text not null,
  memory_value text not null,
  status text not null check (status in ('proposed', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_jid, memory_key)
);

create index if not exists profile_memories_user_status_idx
  on public.profile_memories (user_jid, status);

create unique index if not exists profile_memories_one_pending_per_user_idx
  on public.profile_memories (user_jid)
  where status = 'proposed';

alter table public.reminders enable row level security;
alter table public.user_profiles enable row level security;
alter table public.profile_memories enable row level security;
