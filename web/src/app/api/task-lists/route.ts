import { NextResponse } from "next/server";
import { requireAuthorizedOwner } from "@/lib/auth";
import { databaseError, parseJson, jsonError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { taskListInputSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseAdminClient();
  const { data: currentLists, error: listError } = await supabase
    .from("task_lists")
    .select("id, name, created_at")
    .eq("user_jid", auth.userJid)
    .order("name", { ascending: true });

  if (listError) return databaseError("load task lists", listError);

  if (currentLists.length === 0) {
    const { error } = await supabase
      .from("task_lists")
      .upsert(
        { user_jid: auth.userJid, name: "Inbox" },
        { onConflict: "user_jid,name", ignoreDuplicates: true },
      );
    if (error) return databaseError("create the default task list", error);
    const { data, error: refreshError } = await supabase
      .from("task_lists")
      .select("id, name, created_at")
      .eq("user_jid", auth.userJid)
      .order("name", { ascending: true });
    if (refreshError) return databaseError("reload task lists", refreshError);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json(currentLists, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedOwner();
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, taskListInputSchema);
  if (!parsed.ok) return parsed.error;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("task_lists")
    .insert({ user_jid: auth.userJid, name: parsed.data.name })
    .select("id, name, created_at")
    .single();

  if (error?.code === "23505") return jsonError("A task list with that name already exists.", 409);
  if (error) return databaseError("create task list", error);
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "no-store" } });
}
