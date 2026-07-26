import { apiRequest } from "./client";
import type { OperatorSession } from "../auth/session";

/** Minimal operator presentation for Finding reassignment. */
export interface OperatorSummary {
  id: string;
  email: string | null;
  displayName: string | null;
}

export async function fetchOperators(
  session: OperatorSession,
): Promise<OperatorSummary[]> {
  const data = await apiRequest<{ operators: OperatorSummary[] }>(
    session,
    "/v1/operators",
  );
  return data.operators;
}

/** Compact label for assignment pickers (not a profile surface). */
export function operatorLabel(op: OperatorSummary): string {
  const name = op.displayName?.trim();
  if (name) {
    return name;
  }
  const email = op.email?.trim();
  if (email) {
    return email;
  }
  return op.id;
}
