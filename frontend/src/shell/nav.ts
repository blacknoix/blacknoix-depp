/**
 * Operator nav destinations.
 *
 * Only Findings is implemented. Agents is an honest placeholder for the next
 * operator surface — it must not pretend to be a working product page.
 */

export type NavKind = "live" | "soon";

export interface NavItem {
  id: string;
  label: string;
  to: string;
  kind: NavKind;
}

export const OPERATOR_NAV: readonly NavItem[] = [
  { id: "findings", label: "Findings", to: "/findings", kind: "live" },
  { id: "agents", label: "Agents", to: "/agents", kind: "soon" },
] as const;

export function isNavActive(pathname: string, to: string): boolean {
  if (to === "/") {
    return pathname === "/";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
