import { NextResponse } from "next/server";
import type { CalendarEvent } from "@/lib/domain";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { syncEventAlert } from "@/lib/alerts";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { eventInputSchema, eventUpdateSchema } from "@/lib/validation";

type RouteParams = { params: Promise<{ eventId: string }> };
const eventColumns =
  "id, title, notes, starts_at, ends_at, all_day, timezone, recurrence, recurrence_until, tags, alert_enabled, alert_lead_minutes, created_at";

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, eventUpdateSchema);
  if (!parsed.ok) return parsed.error;
  if (Object.keys(parsed.data).length === 0) return jsonError("Provide at least one field to update.", 400);

  const { eventId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data: current, error: loadError } = await supabase
    .from("calendar_events")
    .select(eventColumns)
    .eq("user_jid", auth.userJid)
    .eq("id", eventId)
    .maybeSingle();
  if (loadError) return databaseError("load calendar event", loadError);
  if (!current) return jsonError("Calendar event not found.", 404);

  const merged = eventInputSchema.safeParse({
    title: parsed.data.title ?? current.title,
    notes: parsed.data.notes ?? current.notes,
    starts_at: parsed.data.starts_at ?? current.starts_at,
    ends_at:
      parsed.data.ends_at !== undefined
        ? parsed.data.ends_at
        : current.ends_at,
    all_day: parsed.data.all_day ?? current.all_day,
    recurrence: parsed.data.recurrence ?? current.recurrence,
    recurrence_until:
      parsed.data.recurrence_until !== undefined
        ? parsed.data.recurrence_until
        : current.recurrence_until,
    tags: parsed.data.tags ?? current.tags,
    alert_enabled: parsed.data.alert_enabled ?? current.alert_enabled,
    alert_lead_minutes: parsed.data.alert_lead_minutes ?? current.alert_lead_minutes,
  });
  if (!merged.success) {
    return NextResponse.json(
      { error: "Request data is invalid.", details: merged.error.issues },
      { status: 400 },
    );
  }

  const { data: event, error } = await supabase
    .from("calendar_events")
    .update({
      ...merged.data,
      timezone: YVONNE_TIME_ZONE,
      updated_at: new Date().toISOString(),
    })
    .eq("user_jid", auth.userJid)
    .eq("id", eventId)
    .select(eventColumns)
    .single();
  if (error) return databaseError("update calendar event", error);

  try {
    const alert = await syncEventAlert(auth.userJid, event as CalendarEvent);
    return NextResponse.json({ event, alert }, { headers: { "Cache-Control": "no-store" } });
  } catch (alertError) {
    console.error("Event was updated but its WhatsApp alert could not be synchronized:", alertError);
    return jsonError("Event saved, but its WhatsApp alert could not be synchronized.", 500);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const { eventId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("user_jid", auth.userJid)
    .eq("id", eventId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError("delete calendar event", error);
  if (!data) return jsonError("Calendar event not found.", 404);
  return new NextResponse(null, { status: 204 });
}
