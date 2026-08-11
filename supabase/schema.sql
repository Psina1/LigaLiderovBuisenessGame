create extension if not exists "pgcrypto";

create table if not exists teams (
  id text primary key,
  team_number smallint not null unique check (team_number between 1 and 7),
  name text not null,
  color text not null check (color in ('red', 'blue')),
  captain_telegram_id bigint unique,
  captain_chat_id bigint unique,
  captain_username text,
  captain_name text,
  captain_bound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'completed')),
  current_stage_index integer not null default -1
    check (current_stage_index >= -1),
  duration_seconds integer not null default 600
    check (duration_seconds between 60 and 86400),
  stage_opened_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline_at is null or stage_opened_at is not null),
  check (deadline_at is null or deadline_at > stage_opened_at)
);

create unique index if not exists game_sessions_one_active_idx
  on game_sessions ((true))
  where status in ('waiting', 'running');

create table if not exists team_stage_progress (
  session_id uuid not null references game_sessions(id) on delete cascade,
  team_id text not null references teams(id),
  stage_index integer not null check (stage_index >= 0),
  status text not null
    check (status in (
      'awaiting-decision',
      'decision-selected',
      'awaiting-file',
      'ready',
      'completed'
    )),
  selected_choice_id text,
  selected_choice_label text,
  selected_source text check (selected_source in ('captain', 'organizer_override')),
  decision_confirmed_at timestamptz,
  file_name text,
  file_url text,
  file_missing_on_forced_advance boolean not null default false,
  q2_hire boolean,
  q2_pr boolean,
  q2_bonus boolean,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, team_id, stage_index),
  check (decision_confirmed_at is null or selected_choice_id is not null),
  check (selected_source is null or selected_choice_id is not null)
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions(id) on delete cascade,
  team_id text not null references teams(id),
  stage_index integer not null check (stage_index >= 0),
  stage_id text not null,
  choice_id text not null,
  choice_label text not null,
  source text not null check (source in ('captain', 'organizer_override')),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, team_id, stage_index)
);

create table if not exists uploaded_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions(id) on delete cascade,
  team_id text not null references teams(id),
  stage_index integer not null check (stage_index >= 0),
  telegram_file_id text not null,
  telegram_file_unique_id text,
  file_name text not null,
  mime_type text,
  file_size integer check (file_size is null or file_size between 0 and 20971520),
  storage_bucket text,
  storage_path text,
  received_at timestamptz not null default now()
);

create table if not exists processed_telegram_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create table if not exists delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references game_sessions(id) on delete cascade,
  team_id text not null references teams(id),
  stage_index integer,
  message_kind text not null default 'stage',
  status text not null check (status in ('sent', 'failed')),
  telegram_message_id bigint,
  error_code text,
  attempted_at timestamptz not null default now()
);

create table if not exists bot_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references game_sessions(id) on delete cascade,
  team_id text references teams(id),
  actor_type text not null default 'system'
    check (actor_type in ('captain', 'organizer', 'system')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_teams_updated_at on teams;
create trigger touch_teams_updated_at
before update on teams
for each row execute function touch_updated_at();

drop trigger if exists touch_game_sessions_updated_at on game_sessions;
create trigger touch_game_sessions_updated_at
before update on game_sessions
for each row execute function touch_updated_at();

drop trigger if exists touch_team_stage_progress_updated_at on team_stage_progress;
create trigger touch_team_stage_progress_updated_at
before update on team_stage_progress
for each row execute function touch_updated_at();

create index if not exists idx_teams_color on teams(color);
create index if not exists idx_team_stage_progress_status
  on team_stage_progress(session_id, stage_index, status);
create index if not exists idx_decisions_team_history
  on decisions(team_id, confirmed_at desc);
create index if not exists idx_uploaded_files_recent
  on uploaded_files(team_id, received_at desc);
create index if not exists idx_delivery_attempts_recent
  on delivery_attempts(team_id, attempted_at desc);
create index if not exists idx_bot_events_recent
  on bot_events(created_at desc);

insert into teams (id, team_number, name, color)
values
  ('team-1', 1, 'Команда 1', 'red'),
  ('team-2', 2, 'Команда 2', 'red'),
  ('team-3', 3, 'Команда 3', 'red'),
  ('team-4', 4, 'Команда 4', 'red'),
  ('team-5', 5, 'Команда 5', 'blue'),
  ('team-6', 6, 'Команда 6', 'blue'),
  ('team-7', 7, 'Команда 7', 'blue')
on conflict (id) do update set
  team_number = excluded.team_number,
  name = excluded.name,
  color = excluded.color;

insert into game_sessions (status, current_stage_index, duration_seconds)
select 'waiting', -1, 600
where not exists (
  select 1 from game_sessions where status in ('waiting', 'running')
);

insert into storage.buckets (id, name, public)
values ('team-files', 'team-files', false)
on conflict (id) do nothing;
