import { NavLink, Outlet } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import { OPERATOR_NAV } from "./nav";

interface Props {
  session: OperatorSession;
  onSignOut: () => void;
}

function formatSession(session: OperatorSession): string {
  if (session.kind === "tenant") {
    return `tenant ${session.tenantId}`;
  }
  return "bearer session";
}

/**
 * Authenticated operator product shell.
 * Session gate stays outside — this layout assumes a verified session.
 */
export function OperatorShell({ session, onSignOut }: Props) {
  return (
    <div className="app-shell">
      <aside className="shell-rail" aria-label="Product navigation">
        <div className="shell-brand">
          <p className="brand">DEPP</p>
          <p className="shell-product muted tiny">Operator</p>
        </div>

        <nav className="shell-nav" aria-label="Primary">
          {OPERATOR_NAV.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end
              className={({ isActive }) =>
                [
                  "shell-nav-link",
                  isActive ? "is-active" : "",
                  item.kind === "soon" ? "is-soon" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              <span>{item.label}</span>
              {item.kind === "soon" ? (
                <span className="nav-soon">Soon</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-session" aria-label="Session context">
            <span className="muted tiny">Signed in</span>
            <span className="mono tiny">{formatSession(session)}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </header>

        <main className="shell-content">
          <Outlet context={{ session }} />
        </main>
      </div>
    </div>
  );
}
