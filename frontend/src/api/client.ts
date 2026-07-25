import type { OperatorSession } from "../auth/session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
  }
}

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.replace(/\/$/, "");
  }
  return "";
}

export function authHeaders(session: OperatorSession): Record<string, string> {
  if (session.kind === "bearer") {
    return { Authorization: `Bearer ${session.accessToken}` };
  }
  // Operator console never sends x-agent-id — agent principals are rejected
  // by dashboard/suppressions/PATCH and must not be affordanced here.
  return { "x-tenant-id": session.tenantId };
}

export async function apiRequest<T>(
  session: OperatorSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  for (const [key, value] of Object.entries(authHeaders(session))) {
    headers.set(key, value);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError({
      status: res.status,
      code: "INVALID_RESPONSE",
      message: "API returned a non-JSON response",
      requestId: null,
    });
  }

  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const requestId =
    typeof record.requestId === "string" ? record.requestId : null;

  if (!res.ok || record.ok !== true) {
    const error =
      typeof record.error === "object" && record.error !== null
        ? (record.error as Record<string, unknown>)
        : {};
    throw new ApiError({
      status: res.status,
      code: typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      message:
        typeof error.message === "string"
          ? error.message
          : `Request failed (${res.status})`,
      requestId,
    });
  }

  return record.data as T;
}
