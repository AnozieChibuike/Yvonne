import { getNextEventAlertTime } from "@/lib/recurrence";
import { YVONNE_TIME_ZONE, type CalendarEvent, type Task } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type LinkedItem = { kind: "task"; id: string } | { kind: "event"; id: string };

async function findLinkedReminder(client: AdminClient, userJid: string, item: LinkedItem) {
  const query =
    item.kind === "task"
      ? client
          .from("reminders")
          .select("id, status")
          .eq("user_jid", userJid)
          .eq("task_id", item.id)
      : client
          .from("reminders")
          .select("id, status")
          .eq("user_jid", userJid)
          .eq("calendar_event_id", item.id);
  return query.maybeSingle();
}

async function syncLinkedReminder(
  client: AdminClient,
  userJid: string,
  item: LinkedItem,
  payload: {
    title: string;
    remind_at: string;
    timezone: string;
    task_id: string | null;
    calendar_event_id: string | null;
  } | null,
) {
  const { data: existing, error: findError } = await findLinkedReminder(client, userJid, item);
  if (findError) throw new Error(`Could not load the linked WhatsApp alert: ${findError.message}`);

  if (!payload) {
    if (!existing || !["scheduled", "sending"].includes(existing.status)) return false;
    const { error } = await client
      .from("reminders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_jid", userJid)
      .eq("id", existing.id);
    if (error) throw new Error(`Could not cancel the linked WhatsApp alert: ${error.message}`);
    return false;
  }

  const reminder = {
    user_jid: userJid,
    title: payload.title,
    kind: "reminder" as const,
    remind_at: payload.remind_at,
    timezone: payload.timezone,
    recurrence: "once" as const,
    recurrence_anchor_date: null,
    local_time: null,
    status: "scheduled" as const,
    tags: [],
    task_id: payload.task_id,
    calendar_event_id: payload.calendar_event_id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await client
      .from("reminders")
      .update(reminder)
      .eq("user_jid", userJid)
      .eq("id", existing.id);
    if (error) throw new Error(`Could not update the linked WhatsApp alert: ${error.message}`);
  } else {
    const { error } = await client.from("reminders").insert(reminder);
    if (error) throw new Error(`Could not create the linked WhatsApp alert: ${error.message}`);
  }
  return true;
}

export async function syncTaskAlert(userJid: string, task: Task) {
  const alertAt =
    task.alert_enabled && task.status === "open" && task.due_at
      ? new Date(new Date(task.due_at).getTime() - task.alert_lead_minutes * 60_000)
      : null;
  const isFuture = alertAt !== null && alertAt.getTime() > Date.now();
  const scheduled = await syncLinkedReminder(
    createSupabaseAdminClient(),
    userJid,
    { kind: "task", id: task.id },
    isFuture
      ? {
          title: `Task due: ${task.title}`,
          remind_at: alertAt.toISOString(),
          timezone: YVONNE_TIME_ZONE,
          task_id: task.id,
          calendar_event_id: null,
        }
      : null,
  );
  return {
    scheduled,
    warning:
      task.alert_enabled && task.status === "open" && task.due_at && !isFuture
        ? "The alert lead time has passed, so no WhatsApp alert was queued."
        : null,
  };
}

export async function syncEventAlert(userJid: string, event: CalendarEvent) {
  const alertAt = getNextEventAlertTime(event);
  const scheduled = await syncLinkedReminder(
    createSupabaseAdminClient(),
    userJid,
    { kind: "event", id: event.id },
    alertAt
      ? {
          title: `Event: ${event.title}`,
          remind_at: alertAt.toISOString(),
          timezone: event.timezone || YVONNE_TIME_ZONE,
          task_id: null,
          calendar_event_id: event.id,
        }
      : null,
  );
  return {
    scheduled,
    warning:
      event.alert_enabled && event.recurrence === "once" && !alertAt
        ? "The alert lead time has passed, so no WhatsApp alert was queued."
        : null,
  };
}
