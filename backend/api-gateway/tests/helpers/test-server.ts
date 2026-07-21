import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, type AppOptions } from "../../src/app";

export interface TestServer {
  /** Base URL, e.g. http://127.0.0.1:54321 */
  url: string;
  close: () => Promise<void>;
}

/**
 * Boots the Express app on an ephemeral port for integration tests.
 *
 * Deliberately imports createApp() rather than src/index.ts: index installs
 * signal handlers, binds a fixed port, and loads dotenv. createApp() has none
 * of those side effects.
 *
 * Port 0 lets the OS assign a free port, so test files can run in parallel
 * without collisions.
 */
export async function startTestServer(options: AppOptions = {}): Promise<TestServer> {
  const app = createApp(options);

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,

    close: () =>
      new Promise<void>((resolve, reject) => {
        // Node's global fetch (undici) pools keep-alive sockets, and
        // server.close() waits for every open socket. Without this the teardown
        // hangs until the keep-alive timeout expires. Destroying sockets
        // outright is fine here — unlike production shutdown, there is nothing
        // left to drain.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
