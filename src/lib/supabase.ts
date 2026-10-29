import { createClient } from "@supabase/supabase-js";
import type { TeamReachUser } from "./teamreach-api.js";
import type { PendingDrop } from "./rsvp-logic.js";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }
  return createClient(url, key);
}

export interface RsvpEventState {
  event_id: string;
  group_id: string;
  title: string;
  event_time: string;
  max_participants: number | null;
  yes_users: TeamReachUser[];
  waitlist_users: TeamReachUser[];
  notified_dropouts: string[];
  group_posts_sent: string[];
  updated_at: string;
}

export async function loadRsvpState(
  eventId: string
): Promise<RsvpEventState | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("teamreach_rsvp_state")
    .select("*")
    .eq("event_id", eventId)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data as RsvpEventState | null;
}

export async function saveRsvpState(state: RsvpEventState): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from("teamreach_rsvp_state").upsert(
    {
      ...state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" }
  );
  if (error) throw error;
}

export async function purgeExpiredRsvpState(): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("teamreach_rsvp_state")
    .delete()
    .lt("event_time", new Date().toISOString());
  if (error) throw error;
}

// --- Pending-drop ledger (backs teamreach_notify_drop) ---

export interface PendingDropRow extends PendingDrop {
  detected_at: string;
  posted_at: string | null;
}

// Record a detected drop. ignoreDuplicates so re-detection never resets posted_at
// (check_rsvps only emits a given drop once anyway via notified_dropouts).
export async function savePendingDrop(drop: PendingDrop): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("teamreach_pending_drops")
    .upsert(drop, {
      onConflict: "event_id,dropped_user_id",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

export async function loadPendingDrop(
  eventId: string,
  droppedUserId: string
): Promise<PendingDropRow | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("teamreach_pending_drops")
    .select("*")
    .eq("event_id", eventId)
    .eq("dropped_user_id", droppedUserId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return (data as PendingDropRow) ?? null;
}

// Atomically claim a drop for posting: stamp posted_at only if it is still null.
// Returns true if THIS call won the claim, false if it was already posted/claimed.
// Guards against double-posting under retries or overlapping cron runs.
export async function claimPendingDrop(
  eventId: string,
  droppedUserId: string
): Promise<boolean> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("teamreach_pending_drops")
    .update({ posted_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("dropped_user_id", droppedUserId)
    .is("posted_at", null)
    .select("event_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Best-effort rollback of a claim when the actual post fails, so a transient
// TeamReach error does not strand the drop as permanently "posted".
export async function releasePendingDrop(
  eventId: string,
  droppedUserId: string
): Promise<void> {
  const supabase = getClient();
  await supabase
    .from("teamreach_pending_drops")
    .update({ posted_at: null })
    .eq("event_id", eventId)
    .eq("dropped_user_id", droppedUserId);
}
