-- Ledger of RSVP drops detected by teamreach_check_rsvps. It is the provenance
-- token for teamreach_notify_drop: that tool will only post a drop that already
-- has a row here, so a model cannot announce a player or event the detector did
-- not actually find. event_time is text to match teamreach_rsvp_state.

create table if not exists teamreach_pending_drops (
  event_id text not null,
  dropped_user_id text not null,
  group_id text not null,
  event_title text not null,
  event_time text not null,
  dropped_first text not null,
  dropped_last text not null,
  spot_filled boolean not null default false,
  new_user_name text,
  from_waitlist boolean not null default false,
  open_spots integer,
  detected_at timestamptz not null default now(),
  posted_at timestamptz,
  primary key (event_id, dropped_user_id)
);

alter table teamreach_pending_drops enable row level security;

create policy "Service role only"
  on teamreach_pending_drops
  for all
  using (auth.role() = 'service_role');
