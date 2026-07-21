import { createApp } from "./app";
import { env } from "./config/env";
import { logLifecycle } from "./lib/log";

/**
 * How long to wait for in-flight requests to finish before forcing exit.
 * Without a cap, a single hung request keeps the process alive until the
 * orchestrator SIGKILLs it.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * How often to reap keep-alive connections that have gone idle during shutdown.
 * See the reaper in shutdown() for why a single sweep is not enough.
 */
const IDLE_REAP_INTERVAL_MS = 100;

const app = createApp();

const server = app.listen(env.port, () => {
  logLifecycle("info", "server_started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
    pid: process.pid,
  });
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  // A second Ctrl+C during shutdown must not restart the sequence.
  if (shuttingDown) {
    logLifecycle("warn", "shutdown_already_in_progress", { signal });
    return;
  }

  shuttingDown = true;
  logLifecycle("info", "shutdown_started", { signal });

  const forceExit = setTimeout(() => {
    logLifecycle("error", "shutdown_timeout", {
      signal,
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Do not let the timer itself hold the event loop open once we finish early.
  forceExit.unref();

  // server.close() waits for every open socket, including keep-alive sockets
  // sitting idle. Sweeping once at shutdown only catches connections idle at
  // that instant: a request still in flight becomes idle when it finishes, and
  // would then hold the process for the full keep-alive timeout. So we sweep
  // repeatedly until close completes, which reaps each connection as it drains
  // while never touching one that is actively serving a request.
  const reapIdle = setInterval(() => {
    server.closeIdleConnections();
  }, IDLE_REAP_INTERVAL_MS);

  reapIdle.unref();
  server.closeIdleConnections();

  // Stops accepting new connections; the callback fires once all existing
  // connections have ended.
  server.close((err) => {
    clearTimeout(forceExit);
    clearInterval(reapIdle);

    if (err) {
      logLifecycle("error", "shutdown_failed", {
        signal,
        errorName: err.name,
        errorMessage: err.message,
      });
      process.exit(1);
    }

    logLifecycle("info", "shutdown_complete", { signal });
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
