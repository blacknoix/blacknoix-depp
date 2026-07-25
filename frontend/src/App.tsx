import { useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { AgentsConsole } from "./agents/AgentsConsole";
import { SessionGate } from "./auth/SessionGate";
import {
  clearSession,
  resolveInitialSession,
  saveSession,
  type OperatorSession,
} from "./auth/session";
import { FindingsConsole } from "./findings/FindingsConsole";
import { OperatorShell } from "./shell/OperatorShell";

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
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <OperatorShell
              session={session}
              onSignOut={() => {
                clearSession();
                setSession(null);
              }}
            />
          }
        >
          <Route index element={<Navigate to="/findings" replace />} />
          <Route path="findings" element={<FindingsConsole />} />
          <Route path="agents" element={<AgentsConsole />} />
          <Route path="*" element={<Navigate to="/findings" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
