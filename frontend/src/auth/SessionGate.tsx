import { useState, type FormEvent } from "react";

import {
  parseBearerToken,
  parseTenantId,
  type OperatorSession,
} from "../auth/session";

interface Props {
  onConnect: (session: OperatorSession) => void;
}

/**
 * Fail-closed session gate. Operators only — no agent-id field.
 */
export function SessionGate({ onConnect }: Props) {
  const [mode, setMode] = useState<"tenant" | "bearer">("tenant");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "tenant") {
      const tenantId = parseTenantId(value);
      if (!tenantId) {
        setError("Tenant id must be a UUID.");
        return;
      }
      onConnect({ kind: "tenant", tenantId });
      return;
    }

    const accessToken = parseBearerToken(value);
    if (!accessToken) {
      setError("Access token is missing or too short.");
      return;
    }
    onConnect({ kind: "bearer", accessToken });
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <p className="brand">DEPP</p>
        <h1>Findings console</h1>
        <p className="lede">
          Operator session required. Agent credentials are not accepted here.
        </p>

        <form onSubmit={submit} className="gate-form">
          <fieldset>
            <legend>Session type</legend>
            <label className="radio">
              <input
                type="radio"
                name="mode"
                checked={mode === "tenant"}
                onChange={() => setMode("tenant")}
              />
              Dev tenant header
            </label>
            <label className="radio">
              <input
                type="radio"
                name="mode"
                checked={mode === "bearer"}
                onChange={() => setMode("bearer")}
              />
              Access JWT
            </label>
          </fieldset>

          <label>
            {mode === "tenant" ? "Tenant UUID" : "Access token"}
            <input
              type={mode === "bearer" ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                mode === "tenant"
                  ? "11111111-1111-4111-8111-111111111111"
                  : "Paste operator access token"
              }
            />
          </label>

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn">
            Open console
          </button>
        </form>
      </div>
    </main>
  );
}
