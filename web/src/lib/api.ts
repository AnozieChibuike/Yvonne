import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

type JsonParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NextResponse };

export async function parseJson<Schema extends ZodType>(
  request: Request,
  schema: Schema,
): Promise<JsonParseResult<z.output<Schema>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      error: NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Request data is invalid.", details: parsed.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function databaseError(operation: string, error: { message: string }) {
  console.error(`Yvonne web API could not ${operation}: ${error.message}`);
  return NextResponse.json({ error: `Could not ${operation}.` }, { status: 500 });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
