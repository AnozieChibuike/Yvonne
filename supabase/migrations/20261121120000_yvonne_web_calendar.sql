create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_jid text not null,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_jid, name),
  unique (user_jid, id)
);

alter table public.tasks
  add column if not exists task_list_id uuid references public.task_lists(id) on delete set null,
  add column if not exists tags text[] not null default array[]::text[],
  add column if not exists alert_enabled boolean not null default false,
  add column if not exists alert_lead_minutes integer not null default 1440
    check (alert_lead_minutes between 0 and 43200);

alter table public.tasks
  add constraint tasks_user_id_unique unique (user_jid, id);

create index if not exists task_lists_user_name_idx
  on public.task_lists (user_jid, name);

create index if not exists tasks_user_list_status_idx
  on public.tasks (user_jid, task_list_id, status);

insert into public.task_lists (user_jid, name)
select distinct user_jid, 'Inbox'
from public.tasks
on conflict (user_jid, name) do nothing;

update public.tasks as task
set task_list_id = task_list.id
from public.task_lists as task_list
where task.task_list_id is null
  and task_list.user_jid = task.user_jid
  and task_list.name = 'Inbox';

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_jid text not null,
  title text not null check (length(trim(title)) > 0),
  notes text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'Africa/Lagos',
  recurrence text not null default 'once'
    check (recurrence in ('once', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_until date,
  tags text[] not null default array[]::text[],
  alert_enabled boolean not null default true,
  alert_lead_minutes integer not null default 1440
    check (alert_lead_minutes between 0 and 43200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_jid, id),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists calendar_events_user_start_idx
  on public.calendar_events (user_jid, starts_at);

alter table public.reminders
  add column if not exists tags text[] not null default array[]::text[],
  add column if not exists recurrence_anchor_date date,
  add column if not exists task_id uuid,
  add column if not exists calendar_event_id uuid;

update public.reminders
set recurrence_anchor_date = (remind_at at time zone timezone)::date
where recurrence <> 'once'
  and recurrence_anchor_date is null;

alter table public.reminders
  drop constraint if exists reminders_recurrence_check;

alter table public.reminders
  add constraint reminders_recurrence_check
    check (recurrence in ('once', 'daily', 'weekly', 'monthly', 'yearly')),
  add constraint reminders_recurrence_anchor_check
    check (
      (recurrence = 'once' and recurrence_anchor_date is null)
      or (recurrence <> 'once' and recurrence_anchor_date is not null)
    ),
  add constraint reminders_task_id_fkey
    foreign key (user_jid, task_id)
    references public.tasks (user_jid, id)
    on delete cascade,
  add constraint reminders_calendar_event_id_fkey
    foreign key (user_jid, calendar_event_id)
    references public.calendar_events (user_jid, id)
    on delete cascade,
  add constraint reminders_one_link_check
    check (task_id is null or calendar_event_id is null);

create unique index if not exists reminders_one_task_alert_idx
  on public.reminders (task_id)
  where task_id is not null;

create unique index if not exists reminders_one_event_alert_idx
  on public.reminders (calendar_event_id)
  where calendar_event_id is not null;

create index if not exists reminders_user_tags_idx
  on public.reminders using gin (tags);

create index if not exists tasks_user_tags_idx
  on public.tasks using gin (tags);

create index if not exists calendar_events_user_tags_idx
  on public.calendar_events using gin (tags);

alter table public.task_lists enable row level security;
alter table public.calendar_events enable row level security;
