/**
 * AUTH_EXPLICIT_ROLES_MODE — staged removal of legacy empty-role→operator.
 *
 * See ADR-0011. Invalid values fail closed at startup.
 * When AUTH_MODE=jwt, unset is rejected (verified JWT must opt in explicitly).
 */

export const EXPLICIT_ROLES_MODES = ["compat", "enforce"] as const;

export type ExplicitRolesMode = (typeof EXPLICIT_ROLES_MODES)[number];

/** Unset / empty → compat when not requireExplicit (dev-header / local / tests). */
export const DEFAULT_EXPLICIT_ROLES_MODE: ExplicitRolesMode = "compat";

export interface ResolveExplicitRolesModeOptions {
  /**
   * When true (AUTH_MODE=jwt), unset/empty AUTH_EXPLICIT_ROLES_MODE fails closed.
   * Not inferred from NODE_ENV.
   */
  requireExplicit?: boolean;
}

export function resolveExplicitRolesMode(
  raw: string | undefined,
  options: ResolveExplicitRolesModeOptions = {},
): ExplicitRolesMode {
  const unset = raw === undefined || raw.trim() === "";

  if (unset) {
    if (options.requireExplicit) {
      throw new Error(
        "AUTH_EXPLICIT_ROLES_MODE must be set explicitly when AUTH_MODE=jwt " +
          `(supported: ${EXPLICIT_ROLES_MODES.join(", ")}). ` +
          "Unset defaults are not allowed for verified JWT authentication.",
      );
    }
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
