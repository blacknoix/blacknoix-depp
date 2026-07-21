import dotenv from "dotenv";

// quiet: true suppresses dotenv's startup banner, which it writes to stdout via
// console.log. Left on, it interleaves free text with our structured JSON log
// stream and breaks line-oriented log parsers.
dotenv.config({ quiet: true });

const port = Number(process.env.PORT ?? 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error("Invalid PORT value");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  appName: process.env.APP_NAME ?? "depp-api-gateway",
};
