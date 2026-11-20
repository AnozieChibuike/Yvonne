import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reminderInputSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, reminderInputSchema);
  if (!parsed.ok) return parsed.error;
  const remindAt = new Date(parsed.data.remind_at);
  if (remindAt <= new Date()) return jsonError("Reminder time must be in the future.", 400);

  const recurrence = parsed.data.recurrence;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reminders")
    .insert({
      user_jid: auth.userJid,
      title: parsed.data.title,
      kind: parsed.data.kind,
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
      tags: parsed.data.tags,
      status: "scheduled",
    })
    .select("id, title, kind, remind_at, timezone, recurrence, status, tags, created_at")
    .single();

  if (error) return databaseError("create reminder", error);
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "no-store" } });
}
