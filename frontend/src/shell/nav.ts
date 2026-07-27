/**
 * Operator nav destinations.
 *
 * Work, Findings, and Agents are live. Keep this list honest — do not add
 * destinations that pretend to be implemented.
 */

export type NavKind = "live" | "soon";

export interface NavItem {
  id: string;
  label: string;
  to: string;
  kind: NavKind;
}

export const OPERATOR_NAV: readonly NavItem[] = [
  { id: "work", label: "Work", to: "/work", kind: "live" },
  { id: "findings", label: "Findings", to: "/findings", kind: "live" },
  { id: "agents", label: "Agents", to: "/agents", kind: "live" },
] as const;

export function isNavActive(pathname: string, to: string): boolean {
  if (to === "/") {
    return pathname === "/";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
