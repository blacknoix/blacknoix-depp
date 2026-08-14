/**
 * Local dist smoke for api-gateway.
 *
 * Boots `dist/index.js` with a minimal production-safe JWT/enforce env (no
 * DATABASE_URL), waits for GET /health, then SIGTERM-stops the child.
 *
 * Proves only: compiled dist starts and answers /health with
 * database.status=not_configured under this local process spawn.
 * Does not claim Docker, staging, scanning, SBOM, Kubernetes, IdP, or DB readiness.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(__dirname, "..");
const distEntry = path.join(gatewayRoot, "dist", "index.js");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to allocate ephemeral port"));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function waitForHealth(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "not attempted";
  while (Date.now() < deadline) {
    try {
      // Connection: close so the health probe does not leave a keep-alive
      // socket that blocks server.close() until SHUTDOWN_TIMEOUT_MS.
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { connection: "close" },
      });
      const body = await res.json();
      if (res.ok && body?.ok === true && body?.database?.status === "not_configured") {
        return body;
      }
      lastErr = `status=${res.status} body=${JSON.stringify(body)}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await delay(200);
  }
  throw new Error(`health not ready within ${timeoutMs}ms: ${lastErr}`);
}

function stopChild(child, signal = "SIGTERM", waitMs = 15_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child did not exit after ${signal} within ${waitMs}ms`));
    }, waitMs);
    child.once("exit", (code, killSignal) => {
      clearTimeout(timer);
      // Windows may surface SIGTERM as a null code with a signal name.
      if (code === null && killSignal) {
        resolve(0);
        return;
      }
      resolve(code ?? 1);
    });
    child.kill(signal);
  });
}

const port = await freePort();
const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  AUTH_MODE: "jwt",
  AUTH_EXPLICIT_ROLES_MODE: "enforce",
  JWT_ACCESS_SECRET: "local-smoke-dist-secret-do-not-reuse-32b",
  JWT_ISSUER: "depp-smoke-dist",
  JWT_AUDIENCE: "depp-api-smoke-dist",
  LOG_SILENT: "1",
};
delete childEnv.DATABASE_URL;
delete childEnv.DATABASE_MIGRATION_URL;

const child = spawn(process.execPath, [distEntry], {
  cwd: gatewayRoot,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

try {
  await waitForHealth(port);
  const code = await stopChild(child, "SIGTERM", 10_000);
  if (code !== 0) {
    throw new Error(`child exited with code ${code} after SIGTERM; stderr=${stderr.slice(-2000)}`);
  }
  console.log("smoke:dist ok (dist /health not_configured; SIGTERM exit 0)");
} catch (err) {
  try {
    await stopChild(child, "SIGKILL", 2_000);
  } catch {
    // best-effort
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`smoke:dist failed: ${message}`);
  if (stderr.trim()) {
    console.error(stderr.slice(-2000));
  }
  process.exitCode = 1;
}
