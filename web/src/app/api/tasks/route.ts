import { NextResponse } from "next/server";
import type { Task } from "@/lib/domain";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { syncTaskAlert } from "@/lib/alerts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { taskInputSchema } from "@/lib/validation";

const taskColumns =
  "id, title, notes, due_at, status, task_list_id, tags, alert_enabled, alert_lead_minutes, created_at";

export async function POST(request: Request) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, taskInputSchema);
  if (!parsed.ok) return parsed.error;

  const supabase = createSupabaseAdminClient();
  if (parsed.data.task_list_id) {
    const { data: list, error } = await supabase
      .from("task_lists")
      .select("id")
      .eq("user_jid", auth.userJid)
      .eq("id", parsed.data.task_list_id)
      .maybeSingle();
    if (error) return databaseError("validate the task list", error);
    if (!list) return jsonError("The selected task list was not found.", 400);
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({ ...parsed.data, user_jid: auth.userJid })
    .select(taskColumns)
    .single();
  if (error) return databaseError("create task", error);

  try {
    const alert = await syncTaskAlert(auth.userJid, task as Task);
    return NextResponse.json({ task, alert }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (alertError) {
    console.error("Task was saved but its WhatsApp alert could not be scheduled:", alertError);
    return jsonError("Task saved, but its WhatsApp alert could not be scheduled.", 500);
  }
}
