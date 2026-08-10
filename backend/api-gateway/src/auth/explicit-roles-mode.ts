/**
 * AUTH_EXPLICIT_ROLES_MODE — staged removal of legacy empty-role→operator.
 *
 * See ADR-0011. Invalid values fail closed at startup.
 */

export const EXPLICIT_ROLES_MODES = ["compat", "enforce"] as const;

export type ExplicitRolesMode = (typeof EXPLICIT_ROLES_MODES)[number];

/** Unset / empty → compat (local + test safety; production must set enforce). */
export const DEFAULT_EXPLICIT_ROLES_MODE: ExplicitRolesMode = "compat";

export function resolveExplicitRolesMode(
  raw: string | undefined,
): ExplicitRolesMode {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_EXPLICIT_ROLES_MODE;
  }

  const normalized = raw.trim().toLowerCase();
  if ((EXPLICIT_ROLES_MODES as readonly string[]).includes(normalized)) {
    return normalized as ExplicitRolesMode;
  }

  throw new Error(
    `Invalid AUTH_EXPLICIT_ROLES_MODE "${raw}". Supported: ${EXPLICIT_ROLES_MODES.join(", ")}.`,
  );
}
