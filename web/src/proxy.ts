import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Supabase public environment variables are not configured." },
      { status: 503 },
    );
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  if (request.nextUrl.pathname.startsWith("/api/")) return response;

  const { data } = await supabase.auth.getUser();
  const allowedEmail = process.env.YVONNE_WEB_ALLOWED_EMAIL?.trim().toLowerCase();
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (isLoginPage && !data.user) return response;
  if (data.user && allowedEmail && data.user.email?.trim().toLowerCase() === allowedEmail) {
    if (isLoginPage) return redirectWithCookies(new URL("/calendar", request.url), response);
    return response;
  }

  if (data.user) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error(`Could not sign out an unauthorized web account: ${error.message}`);
    if (isLoginPage) return response;
  }

  if (!allowedEmail) {
    return NextResponse.json(
      { error: "YVONNE_WEB_ALLOWED_EMAIL is not configured." },
      { status: 503 },
    );
  }

  if (isLoginPage) return response;

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return redirectWithCookies(loginUrl, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
