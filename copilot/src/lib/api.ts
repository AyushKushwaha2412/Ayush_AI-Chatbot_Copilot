import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) } });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Wraps a handler with consistent error → JSON mapping. */
export function route<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<Response>,
) {
  return async (req: NextRequest, ...args: Args): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return fail(
          `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'field'} — ${i.message}`).join('; ')}`,
          422,
        );
      }
      if (err instanceof ApiError) return fail(err.message, err.status);
      const message = err instanceof Error ? err.message : 'Unexpected server error';
      console.error('[api]', message);
      return fail(message, 500);
    }
  };
}

export async function body<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError('Request body must be valid JSON.', 400);
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(`"${field}" is required.`, 422);
  return value.trim();
}

/**
 * Optional access gate. Enabled only when APP_ACCESS_CODE is set, in which
 * case the browser must present the code (stored in an httpOnly cookie).
 */
export function isAuthorised(req: NextRequest): boolean {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return true;
  const header = req.headers.get('x-copilot-code');
  const cookie = req.cookies.get('copilot_code')?.value;
  return header === code || cookie === code;
}
