import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reminderInputSchema, reminderUpdateSchema } from "@/lib/validation";

type RouteParams = { params: Promise<{ reminderId: string }> };
const reminderColumns =
  "id, title, kind, remind_at, timezone, recurrence, status, tags, created_at";

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, reminderUpdateSchema);
  if (!parsed.ok) return parsed.error;
  if (Object.keys(parsed.data).length === 0) return jsonError("Provide at least one field to update.", 400);

  const { reminderId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data: current, error: loadError } = await supabase
    .from("reminders")
    .select(`${reminderColumns}, task_id, calendar_event_id`)
    .eq("user_jid", auth.userJid)
    .eq("id", reminderId)
    .is("task_id", null)
    .is("calendar_event_id", null)
    .maybeSingle();
  if (loadError) return databaseError("load reminder", loadError);
  if (!current) return jsonError("Reminder not found.", 404);

  const merged = reminderInputSchema.safeParse({
    title: parsed.data.title ?? current.title,
    kind: parsed.data.kind ?? current.kind,
    remind_at: parsed.data.remind_at ?? current.remind_at,
    recurrence: parsed.data.recurrence ?? current.recurrence,
    tags: parsed.data.tags ?? current.tags,
  });
  if (!merged.success) {
    return NextResponse.json(
      { error: "Request data is invalid.", details: merged.error.issues },
      { status: 400 },
    );
  }

  const remindAt = new Date(merged.data.remind_at);
  if (remindAt <= new Date()) return jsonError("Reminder time must be in the future.", 400);
  const recurrence = merged.data.recurrence;
  const { data, error } = await supabase
    .from("reminders")
    .update({
      title: merged.data.title,
      kind: merged.data.kind,
      remind_at: remindAt.toISOString(),
      timezone: YVONNE_TIME_ZONE,
      recurrence,
      recurrence_anchor_date:
        recurrence === "once"
          ? null
          : formatInTimeZone(remindAt, YVONNE_TIME_ZONE, "yyyy-MM-dd"),
      local_time:
        recurrence === "once"
          ? null
          : formatInTimeZone(remindAt, YVONNE_TIME_ZONE, "HH:mm"),
      tags: merged.data.tags,
      status: "scheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("user_jid", auth.userJid)
    .eq("id", reminderId)
    .select(reminderColumns)
    .single();
  if (error) return databaseError("update reminder", error);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const { reminderId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reminders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("user_jid", auth.userJid)
    .eq("id", reminderId)
    .is("task_id", null)
    .is("calendar_event_id", null)
    .in("status", ["scheduled", "sending"])
    .select("id")
    .maybeSingle();
  if (error) return databaseError("cancel reminder", error);
  if (!data) return jsonError("Reminder not found or no longer active.", 404);
  return new NextResponse(null, { status: 204 });
}
