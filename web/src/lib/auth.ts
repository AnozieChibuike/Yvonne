import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthorizedOwner =
  | { ok: true; userJid: string }
  | { ok: false; response: NextResponse };

export async function requireAuthorizedOwner(): Promise<AuthorizedOwner> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  const allowedEmail = process.env.YVONNE_WEB_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowedEmail) {
    console.error("YVONNE_WEB_ALLOWED_EMAIL is not configured.");
    return {
      ok: false,
      response: NextResponse.json({ error: "Yvonne web access is not configured." }, { status: 503 }),
    };
  }
  if (user.email?.trim().toLowerCase() !== allowedEmail) {
    return {
      ok: false,
      response: NextResponse.json({ error: "This account is not authorized." }, { status: 403 }),
    };
  }

  const userJid = process.env.YVONNE_WEB_USER_JID?.trim();
  if (!userJid) {
    console.error("YVONNE_WEB_USER_JID is not configured.");
    return {
      ok: false,
      response: NextResponse.json({ error: "Yvonne web access is not configured." }, { status: 503 }),
    };
  }

  return { ok: true, userJid };
}
