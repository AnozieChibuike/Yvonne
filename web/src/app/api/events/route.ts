import { NextResponse } from "next/server";
import type { CalendarEvent } from "@/lib/domain";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { syncEventAlert } from "@/lib/alerts";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { eventInputSchema } from "@/lib/validation";

const eventColumns =
  "id, title, notes, starts_at, ends_at, all_day, timezone, recurrence, recurrence_until, tags, alert_enabled, alert_lead_minutes, created_at";

export async function POST(request: Request) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, eventInputSchema);
  if (!parsed.ok) return parsed.error;

  const supabase = createSupabaseAdminClient();
  const { data: event, error } = await supabase
    .from("calendar_events")
    .insert({
      ...parsed.data,
      user_jid: auth.userJid,
      timezone: YVONNE_TIME_ZONE,
    })
    .select(eventColumns)
    .single();
  if (error) return databaseError("create calendar event", error);

  try {
    const alert = await syncEventAlert(auth.userJid, event as CalendarEvent);
    return NextResponse.json({ event, alert }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (alertError) {
    console.error("Event was saved but its WhatsApp alert could not be scheduled:", alertError);
    return jsonError("Event saved, but its WhatsApp alert could not be scheduled.", 500);
  }
}
