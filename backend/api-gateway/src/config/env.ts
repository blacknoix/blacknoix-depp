import dotenv from "dotenv";

import { resolveAuthMode } from "../auth/auth-mode";

// quiet: true suppresses dotenv's startup banner, which it writes to stdout via
// console.log. Left on, it interleaves free text with our structured JSON log
// stream and breaks line-oriented log parsers.
dotenv.config({ quiet: true });

const port = Number(process.env.PORT ?? 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error("Invalid PORT value");
}

const nodeEnv = process.env.NODE_ENV ?? "development";

// Throws on an unrecognised mode, or on an unverified mode in production.
// Evaluated at import time so the service fails to start rather than serving
// requests with weaker authentication than intended.
const authMode = resolveAuthMode(process.env.AUTH_MODE, nodeEnv);

export const env = {
  nodeEnv,
  port,
  appName: process.env.APP_NAME ?? "depp-api-gateway",
  authMode,

  // Left undefined when unset: createApp() owns the default so there is only
  // one place to change it. An invalid value fails closed — body-parser throws
  // at construction, so the service will not start.
  jsonBodyLimit: process.env.BODY_LIMIT_DEFAULT,
};
