import { NextResponse } from "next/server";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, jsonError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ type: string; id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const { type, id } = await params;
  const supabase = createSupabaseAdminClient();

  if (type === "task") {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, notes, due_at, status, task_list_id, tags, alert_enabled, alert_lead_minutes, created_at")
      .eq("user_jid", auth.userJid)
      .eq("id", id)
      .maybeSingle();
    if (error) return databaseError("load task", error);
    if (!data) return jsonError("Task not found.", 404);
    return NextResponse.json({ type, item: data }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (type === "reminder") {
    const { data, error } = await supabase
      .from("reminders")
      .select("id, title, kind, remind_at, timezone, recurrence, recurrence_anchor_date, local_time, status, tags, created_at")
      .eq("user_jid", auth.userJid)
      .eq("id", id)
      .is("task_id", null)
      .is("calendar_event_id", null)
      .maybeSingle();
    if (error) return databaseError("load reminder", error);
    if (!data) return jsonError("Reminder not found.", 404);
    return NextResponse.json({ type, item: data }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (type === "event") {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("id, title, notes, starts_at, ends_at, all_day, timezone, recurrence, recurrence_until, tags, alert_enabled, alert_lead_minutes, created_at")
      .eq("user_jid", auth.userJid)
      .eq("id", id)
      .maybeSingle();
    if (error) return databaseError("load calendar event", error);
    if (!data) return jsonError("Calendar event not found.", 404);
    return NextResponse.json({ type, item: data }, { headers: { "Cache-Control": "private, no-store" } });
  }

  return jsonError("Unknown Yvonne item type.", 400);
}
