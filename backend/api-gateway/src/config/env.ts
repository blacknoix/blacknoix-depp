import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error("Invalid PORT value");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  appName: process.env.APP_NAME ?? "depp-api-gateway",
};
