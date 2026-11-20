"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, LockKeyhole } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function safeNextPath(nextPath: string) {
  try {
    const base = window.location.origin;
    const target = new URL(nextPath, base);
    return target.origin === base
      ? `${target.pathname}${target.search}${target.hash}`
      : "/calendar";
  } catch {
    return "/calendar";
  }
}

export function LoginForm({
  nextPath,
  authError,
}: {
  nextPath: string;
  authError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    authError === "not-authorized" ? "This account is not authorized to use Yvonne." : "",
  );
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError("Sign-in failed. Check your credentials and try again.");
        return;
      }
      router.replace(safeNextPath(nextPath));
      router.refresh();
    } catch (signInError) {
      console.error("Yvonne web sign-in failed:", signInError);
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-brand">
        <div className="brand-mark">
          <Bot aria-hidden="true" />
        </div>
        <span>yvonne</span>
      </div>
      <Card className="login-card">
        <CardHeader>
          <div className="eyebrow">YOUR PRIVATE SPACE</div>
          <CardTitle>Welcome back.</CardTitle>
          <CardDescription>
            Sign in to your personal calendar and assistant workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="login-form" onSubmit={handleSubmit}>
            {error ? (
              <Alert variant="destructive">
                <LockKeyhole aria-hidden="true" />
                <AlertTitle>Unable to sign in</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="field-stack">
              <Label htmlFor="email">Email address</Label>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="field-stack">
              <Label htmlFor="password">Password</Label>
              <Input
                autoComplete="current-password"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <Button className="login-submit" disabled={pending} type="submit">
              {pending ? "Signing in..." : "Sign in"}
              {!pending ? <ArrowRight data-icon="inline-end" aria-hidden="true" /> : null}
            </Button>
            <p className="login-footnote">
              Access is restricted to the Yvonne owner account. New accounts cannot sign up here.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
