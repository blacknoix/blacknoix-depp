import { useState } from "react";

import { SessionGate } from "./auth/SessionGate";
import {
  clearSession,
  resolveInitialSession,
  saveSession,
  type OperatorSession,
} from "./auth/session";
import { FindingsConsole } from "./findings/FindingsConsole";

export function App() {
  const [session, setSession] = useState<OperatorSession | null>(() =>
    resolveInitialSession(),
  );

  if (!session) {
    return (
      <SessionGate
        onConnect={(next) => {
          saveSession(next);
          setSession(next);
        }}
      />
    );
  }

  return (
    <FindingsConsole
      session={session}
      onSignOut={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}
