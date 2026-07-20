import express from "express";
import healthRouter from "./routes/health";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      service: "api-gateway",
      status: "ok",
      message: "DEPP API Gateway is running",
    });
  });

  app.use("/health", healthRouter);

  return app;
}
