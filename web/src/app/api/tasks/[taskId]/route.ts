import { NextResponse } from "next/server";
import type { Task } from "@/lib/domain";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { syncTaskAlert } from "@/lib/alerts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { taskUpdateSchema } from "@/lib/validation";

const taskColumns =
  "id, title, notes, due_at, status, task_list_id, tags, alert_enabled, alert_lead_minutes, created_at";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, taskUpdateSchema);
  if (!parsed.ok) return parsed.error;
  if (Object.keys(parsed.data).length === 0) return jsonError("Provide at least one field to update.", 400);

  const { taskId } = await params;
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

  const update = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
    ...(parsed.data.status === "completed"
      ? { completed_at: new Date().toISOString() }
      : parsed.data.status === "open"
        ? { completed_at: null }
        : {}),
  };
  const { data: task, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("user_jid", auth.userJid)
    .eq("id", taskId)
    .select(taskColumns)
    .maybeSingle();
  if (error) return databaseError("update task", error);
  if (!task) return jsonError("Task not found.", 404);

  try {
    const alert = await syncTaskAlert(auth.userJid, task as Task);
    return NextResponse.json({ task, alert }, { headers: { "Cache-Control": "no-store" } });
  } catch (alertError) {
    console.error("Task was updated but its WhatsApp alert could not be synchronized:", alertError);
    return jsonError("Task saved, but its WhatsApp alert could not be synchronized.", 500);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const { taskId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("user_jid", auth.userJid)
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError("delete task", error);
  if (!data) return jsonError("Task not found.", 404);
  return new NextResponse(null, { status: 204 });
}
