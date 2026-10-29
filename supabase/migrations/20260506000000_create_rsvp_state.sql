create table if not exists teamreach_rsvp_state (
  event_id text primary key,
  group_id text not null,
  title text not null,
  event_time text not null,
  max_participants integer,
  yes_users jsonb not null default '[]'::jsonb,
  waitlist_users jsonb not null default '[]'::jsonb,
  notified_dropouts jsonb not null default '[]'::jsonb,
  group_posts_sent jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table teamreach_rsvp_state enable row level security;

create policy "Service role only"
  on teamreach_rsvp_state
  for all
  using (auth.role() = 'service_role');
