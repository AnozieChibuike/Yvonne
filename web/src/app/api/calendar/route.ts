import { NextResponse } from "next/server";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseAdminClient();
  const [tasks, reminders, events, taskLists] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, due_at, status, task_list_id, tags, alert_enabled, alert_lead_minutes, created_at")
      .eq("user_jid", auth.userJid)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase
      .from("reminders")
      .select("id, title, kind, remind_at, timezone, recurrence, recurrence_anchor_date, local_time, status, tags, created_at")
      .eq("user_jid", auth.userJid)
      .is("task_id", null)
      .is("calendar_event_id", null)
      .in("status", ["scheduled", "sending"])
      .order("remind_at", { ascending: true })
      .limit(1000),
    supabase
      .from("calendar_events")
      .select("id, title, notes, starts_at, ends_at, all_day, timezone, recurrence, recurrence_until, tags, alert_enabled, alert_lead_minutes, created_at")
      .eq("user_jid", auth.userJid)
      .order("starts_at", { ascending: true })
      .limit(1000),
    supabase
      .from("task_lists")
      .select("id, name, created_at")
      .eq("user_jid", auth.userJid)
      .order("name", { ascending: true }),
  ]);

  if (tasks.error) return databaseError("load tasks", tasks.error);
  if (reminders.error) return databaseError("load reminders", reminders.error);
  if (events.error) return databaseError("load calendar events", events.error);
  if (taskLists.error) return databaseError("load task lists", taskLists.error);

  return NextResponse.json(
    {
      tasks: tasks.data,
      reminders: reminders.data,
      events: events.data,
      taskLists: taskLists.data,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
