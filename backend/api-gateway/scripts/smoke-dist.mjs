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

let failures = 0;

function pass(name) {
  console.log(`ok   ${name}`);
}

function fail(name, detail) {
  failures += 1;
  console.error(`FAIL ${name}`);
  if (detail) {
    console.error(`     ${String(detail).split("\n").slice(0, 6).join("\n     ")}`);
  }
}

/**
 * Base child environment.
 *
 * The developer's own AUTH_/JWT_/DATABASE_ values are stripped rather than
 * inherited: each case must be decided by what it passes in, or a machine with
 * a populated .env would silently test a different configuration.
 */
function childEnvWith(overrides) {
  const env = { ...process.env, LOG_SILENT: "1", ...overrides };
  delete env.DATABASE_URL;
  delete env.DATABASE_MIGRATION_URL;
  for (const key of ["AUTH_MODE", "AUTH_EXPLICIT_ROLES_MODE", "JWT_ACCESS_SECRET", "JWT_ISSUER", "JWT_AUDIENCE"]) {
    if (!(key in overrides)) delete env[key];
  }
  return env;
}

function spawnDist(env) {
  return spawn(process.execPath, [distEntry], {
    cwd: gatewayRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Resolves the exit code, or rejects if the process outlives the timeout. */
function waitForExit(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

/**
 * Check 1 — the built artifact boots, answers liveness, and shuts down on
 * SIGTERM. Runs under the minimum configuration that is allowed to start, so it
 * isolates "does the compiled output run" from any configuration question.
 */
async function checkLiveness() {
  const name = "dist boots, serves /health, exits 0 on SIGTERM";
  const port = await freePort();
  const child = spawnDist(
    childEnvWith({
      NODE_ENV: "production",
      PORT: String(port),
      AUTH_MODE: "jwt",
      AUTH_EXPLICIT_ROLES_MODE: "enforce",
      JWT_ACCESS_SECRET: "local-smoke-dist-secret-do-not-reuse-32b",
      JWT_ISSUER: "depp-smoke-dist",
      JWT_AUDIENCE: "depp-api-smoke-dist",
    }),
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

  try {
    await waitForHealth(port);
    const code = await stopChild(child, "SIGTERM", 10_000);
    if (code !== 0) {
      fail(name, `exit=${code} after SIGTERM; stderr=${stderr.slice(-2000)}`);
      return;
    }
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
    try {
      await stopChild(child, "SIGKILL", 2_000);
    } catch {
      // best-effort
    }
  }
}

/**
 * Fail-closed checks — each configuration must stop the process rather than
 * serve requests with weaker guarantees than intended. A zero exit here means
 * the guard is gone, which is the regression worth catching.
 */
async function checkFailsClosed(name, overrides, expectedInStderr) {
  const port = await freePort();
  const child = spawnDist(childEnvWith({ PORT: String(port), ...overrides }));

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

  try {
    const code = await waitForExit(child);
    if (code === 0) {
      fail(name, "exited 0; expected a non-zero fail-closed exit");
      return;
    }
    if (expectedInStderr && !stderr.includes(expectedInStderr)) {
      fail(name, `stderr did not mention "${expectedInStderr}"\n${stderr.slice(-2000)}`);
      return;
    }
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

await checkLiveness();

// ADR-0003 / jwt/config.ts: the HS256 secret has a 32-character minimum.
await checkFailsClosed(
  "AUTH_MODE=jwt with a too-short JWT_ACCESS_SECRET fails closed",
  {
    NODE_ENV: "production",
    AUTH_MODE: "jwt",
    AUTH_EXPLICIT_ROLES_MODE: "enforce",
    JWT_ACCESS_SECRET: "too-short",
    JWT_ISSUER: "depp-smoke-dist",
    JWT_AUDIENCE: "depp-api-smoke-dist",
  },
  "JWT_ACCESS_SECRET",
);

// ADR-0011: verified authentication must opt into a roles mode explicitly.
await checkFailsClosed(
  "AUTH_MODE=jwt without AUTH_EXPLICIT_ROLES_MODE fails closed",
  {
    NODE_ENV: "production",
    AUTH_MODE: "jwt",
    JWT_ACCESS_SECRET: "local-smoke-dist-secret-do-not-reuse-32b",
    JWT_ISSUER: "depp-smoke-dist",
    JWT_AUDIENCE: "depp-api-smoke-dist",
  },
  "AUTH_EXPLICIT_ROLES_MODE",
);

// ADR-0002: an unverified mode must never start in production. This is also the
// guard the container image relies on, since it sets NODE_ENV=production.
await checkFailsClosed(
  "AUTH_MODE=dev-header with NODE_ENV=production fails closed",
  { NODE_ENV: "production", AUTH_MODE: "dev-header" },
  "dev-header",
);

if (failures > 0) {
  console.error(`\nsmoke:dist failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log("\nsmoke:dist ok — build + boot + fail-closed startup only; not container or staging evidence.");
}
